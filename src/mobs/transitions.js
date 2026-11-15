// Contact lottery for air <-> water <-> liquid transitions (rule-based).
// Three-free and pure: no voxel reads here — the mover classifies the
// contact (dry-water, shore-low, shore-high, open) with step.js probes and
// this module only draws. One draw per contact: a rising edge (contact key
// change) plus a TRANS_COOL cooldown gates every draw, so a held contact
// replays its stored decision instead of re-rolling every tick. Flank graze
// keeps the legacy 50/50 latch in roam.js — only frontal (nose-blocked)
// contacts draw from the tables below. Water draws are dry-approach only:
// a mob already floating never draws its way anywhere (it steers, hops, or
// rides on the existing machinery). Unavailable options renormalize; past
// MAX_REROLLS the contact falls back to the legacy grind/stuck path.
import { mobCanFloat } from "./registry.js";

// One draw per contact visit: refusals hold the next draw off this long.
export const TRANS_COOL = 2.0;
// Dry -> water table: dive in, ride the edge, or keep roaming.
export const DRY_WATER_W = [0.6, 0.2, 0.2];
export const DRY_WATER_KEYS = ["dive", "ride", "ignore"];
// Floating -> low shore table: hop out, ride the rim, or keep swimming.
export const SHORE_LOW_W = [0.6, 0.2, 0.2];
export const SHORE_LOW_KEYS = ["exit", "ride", "ignore"];
// Floating -> high wall table: ride it or keep swimming.
export const SHORE_HIGH_W = [0.5, 0.5];
export const SHORE_HIGH_KEYS = ["ride", "ignore"];
// Past this many re-rolls onto an unavailable option the contact gives up
// and falls back to grind/stuck instead of rolling forever.
export const MAX_REROLLS = 2;

// Dry-approach gate: only a float-capable mob still on dry land draws its
// way into water. Floating mobs and non-floaters keep legacy behavior.
export function isDryApproach(mob, floating) {
  return !floating && mobCanFloat(mob);
}

// Weighted index draw: r in [0, 1) over weights summing to ~1.
export function drawIndex(weights, r) {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}

// Draw a key from weights, skipping unavailable options: a drawn option
// that is currently unavailable re-rolls (bounded), and the survivors
// renormalize implicitly since later draws are uniform over [0, 1).
// available is a (key) => bool predicate. Returns the key or null when
// every draw lands unavailable (caller falls back to grind/stuck).
export function drawWithRerolls(keys, weights, available, rand = Math.random) {
  let pick = null;
  for (let k = 0; k <= MAX_REROLLS; k++) {
    const i = drawIndex(weights, rand());
    if (available(keys[i])) {
      pick = keys[i];
      break;
    }
  }
  return pick;
}

// Dry -> water contact (frontal, dry approach): dive, ride, or ignore.
export function resolveDryWaterContact(rand = Math.random, avail = null) {
  const ok = avail ?? (() => true);
  return drawWithRerolls(DRY_WATER_KEYS, DRY_WATER_W, ok, rand);
}

// Floating -> low shore contact (frontal): exit, ride, or ignore.
export function resolveShoreLow(rand = Math.random, avail = null) {
  const ok = avail ?? (() => true);
  return drawWithRerolls(SHORE_LOW_KEYS, SHORE_LOW_W, ok, rand);
}

// Floating -> high wall contact (frontal): ride or ignore.
export function resolveShoreHigh(rand = Math.random, avail = null) {
  const ok = avail ?? (() => true);
  return drawWithRerolls(SHORE_HIGH_KEYS, SHORE_HIGH_W, ok, rand);
}

// Cooldown gate: a fresh draw needs the timer run out.
export function coolReady(mob) {
  return (mob.transCoolT ?? 0) <= 0;
}

// Contact identity: kind plus frontal/flank stance — a stance change is a
// new contact (a graze turning head-on re-rolls once cooled).
export function contactKey(contact) {
  if (!contact) return null;
  return `${contact.kind}:${contact.frontal ? "F" : "f"}`;
}

// Single draw per contact. contact is null (no contact) or
// {kind, frontal, floating, available}. Returns {intent, consumed} or null:
// - null contact clears the latch and draws nothing.
// - held contact replays the stored decision with no new draw.
// - flank contacts stay legacy (null, no draw) — roam.js owns the coin.
// - non-float-capable mobs stay legacy (null, no draw).
// - open air edges exit outright (no draw).
// - cooled contacts draw nothing (null) until the timer runs out.
export function transitionTick(mob, contact, rand = Math.random) {
  if (!contact) {
    mob._transPrev = null;
    mob._transDecision = null;
    return null;
  }
  const key = contactKey(contact);
  const rising = mob._transPrev !== key;
  mob._transPrev = key;
  if (!rising) {
    const held = mob._transDecision ?? null;
    return held ? { intent: held, consumed: false } : null;
  }
  mob._transDecision = null;
  if (!mobCanFloat(mob)) return null;
  if (contact.kind === "dry-water" && (contact.floating || !isDryApproach(mob, contact.floating))) return null;
  if ((contact.kind === "shore-low" || contact.kind === "shore-high" || contact.kind === "open") && !contact.floating) {
    return null;
  }
  if (contact.frontal !== true) return null;
  if (!coolReady(mob)) return null;
  if (contact.kind === "open") {
    mob.transCoolT = TRANS_COOL;
    mob._transDecision = "exit";
    return { intent: "exit", consumed: false };
  }
  const avail = contact.available ?? (() => true);
  let intent = null;
  if (contact.kind === "dry-water") intent = resolveDryWaterContact(rand, avail);
  else if (contact.kind === "shore-low") intent = resolveShoreLow(rand, avail);
  else if (contact.kind === "shore-high") intent = resolveShoreHigh(rand, avail);
  else return null;
  mob.transCoolT = TRANS_COOL;
  if (intent) {
    mob._transDecision = intent;
    return { intent, consumed: true };
  }
  return null;
}

// Veto timers behind ignore/ride decisions: while set, the physical
// executors hold (no dive into water, no auto-hop out) so the decision
// survives until the stuck detector re-picks the mob away. Ride holds the
// bank both ways while it retries its latch.
export function armTransitionVeto(mob, intent) {
  if (intent === "ignore" || intent === "ride") {
    mob._transNoDiveT = TRANS_COOL;
    mob._transNoExitT = TRANS_COOL;
  }
}

export function tickTransitionTimers(mob, dt) {
  mob.transCoolT = Math.max(0, (mob.transCoolT ?? 0) - dt);
  mob._transNoDiveT = Math.max(0, (mob._transNoDiveT ?? 0) - dt);
  mob._transNoExitT = Math.max(0, (mob._transNoExitT ?? 0) - dt);
}

export function diveVetoed(mob) {
  return (mob._transNoDiveT ?? 0) > 0;
}

export function exitVetoed(mob) {
  return (mob._transNoExitT ?? 0) > 0;
}
