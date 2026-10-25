// Stable-key mob type registry. Capabilities are data so future mob kinds
// need no framework branches: locomotion dispatches on walk/jump/float/
// swim/fly, guided-TNT targeting on homingTnt. float is passive buoyancy at
// the liquid surface (2/3 of the body out of the water); swim is directed
// underwater locomotion (fish only). Flying mobs default to homing-TNT
// targeting with the ordinary three-shot volley cap.
const MOB_DEFAULTS = {
  capabilities: { walk: false, jump: false, float: false, swim: false, flying: false, homingTnt: false },
  homingTntShots: 3,
  homingTntDamage: 1,
  aimHitTest: null,
  create: null,
  tick: null,
  damage: null,
  dispose: null,
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

export function createMob(key, context) {
  const spec = mobType(key);
  if (!spec?.create) return null;
  const mob = spec.create(context);
  if (mob) mob.type = key;
  return mob;
}
