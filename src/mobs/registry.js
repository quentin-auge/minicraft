// Stable-key mob type registry. Capabilities are data so future mob kinds
// need no framework branches: locomotion dispatches on walk/jump/float/
// swim/fly, guided-TNT targeting on homingTnt, grab eligibility on
// grabbable (the carry hook refuses whatever lacks it — dragon first,
// answering spec.refuseMsg when set).
// float is passive surface buoyancy at
// the liquid surface (2/3 of the body out of the water); swim is directed
// underwater locomotion (fish only). Flying mobs default to homing-TNT
// targeting with the ordinary three-shot volley cap.
//
// Mob contract (every kind, present and future): each mob carries
// {pos, yaw, hw, h, alive, dim, type} plus an optional visual grab box
// ({grabR, grabH} or axial {grabSide, grabFront, grabBack}, default hw/h;
// the pick scale never drops below the exact box). yaw follows three.js
// rotation.y semantics, 0 = facing +z local (head at +z); the mover mirrors
// it onto root.rotation.y. _carried freezes a mob: every tick loop skips
// carried mobs through isCarried() (carry.js), and no system moves them
// (homing, separation, enderman teleport).
const MOB_DEFAULTS = {
  capabilities: { walk: false, jump: false, float: false, swim: false, flying: false, homingTnt: false, grabbable: false },
  homingTntShots: 3,
  homingTntDamage: 1,
  aimHitTest: null,
  create: null,
  tick: null,
  damage: null,
  dispose: null,
  // release(mob): optional per-type reset on carry release (fish tunnel
  // state, bird perch, ...). The shared reset (velocity, steering, stale
  // lane state) always runs first.
  release: null,
  // refuseMsg: toast answered when an ungrabbable kind is aimed at.
  refuseMsg: null,
  // label: display name (menus, toasts). The key is the fallback.
  label: null,
  // spawn(ctx): optional placement hook for the cheat spawn menu. Only
  // kinds that register one are placeable, so the menu lists exactly
  // the kinds that can be dropped into the world (the boss dragon has
  // no hook and never shows up). The hook owns the model, the free-spot
  // rules, and the dimension rules: ctx is {scene, dim, x, y, z, rand}
  // with the wanted feet position in the active dimension.
  spawn: null,
};

export const MOB_TYPES = [];
const byKey = new Map();

export function registerMobType(spec) {
  if (!spec?.key || byKey.has(spec.key)) throw new Error(`Invalid or duplicate mob type: ${spec?.key}`);
  const entry = {
    ...MOB_DEFAULTS,
    ...spec,
    capabilities: { ...MOB_DEFAULTS.capabilities, ...spec.capabilities },
  };
  if (spec.capabilities?.homingTnt == null) entry.capabilities.homingTnt = entry.capabilities.flying;
  byKey.set(entry.key, entry);
  MOB_TYPES.push(entry);
  return entry;
}

export function mobType(key) {
  return byKey.get(key) ?? null;
}

// Display name of a kind: the spec label, else the key with a capital.
export function mobLabel(key) {
  const spec = mobType(key);
  if (spec?.label) return spec.label;
  if (!key) return "";
  return key[0].toUpperCase() + key.slice(1);
}

export function createMob(key, context) {
  const spec = mobType(key);
  if (!spec?.create) return null;
  const mob = spec.create(context);
  if (mob) mob.type = key;
  return mob;
}

// Live-mob sources: each mob module registers its set once at load, so
// aggregators (grab picker, debug overlay) never hardcode kind lists —
// future kinds appear by registering, never by editing callers.
const mobSources = new Map();

export function registerMobSource(name, listFn) {
  if (mobSources.has(name) || typeof listFn !== "function") throw new Error(`Invalid or duplicate mob source: ${name}`);
  mobSources.set(name, listFn);
}

export function allMobs() {
  const out = [];
  for (const listFn of mobSources.values()) {
    const mobs = listFn();
    if (mobs) for (const m of mobs) out.push(m);
  }
  return out;
}
