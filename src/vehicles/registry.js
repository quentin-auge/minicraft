// Vehicle registry: every ridable vehicle kind registers one spec here; the
// runtime dispatches through the table, so a second kind (minecart, boat…)
// adds an entry, never a fork. Light on purpose: the spec only carries the
// capability flags the player loop needs today.
//   - key: stable id ("rocket").
//   - name: display label.
//   - carriesMobs: overlapping mobs ride the hull delta (rocket: true) and
//     fade with it; kinds that don't implement riders keep false.
export const VEHICLE_TYPES = [];

export function registerVehicleType(spec) {
  if (!spec || typeof spec.key !== "string" || !spec.key) {
    throw new Error("registerVehicleType: spec needs a string key");
  }
  if (VEHICLE_TYPES.some((s) => s.key === spec.key)) {
    throw new Error("registerVehicleType: duplicate key " + spec.key);
  }
  VEHICLE_TYPES.push({ carriesMobs: false, ...spec });
  return VEHICLE_TYPES[VEHICLE_TYPES.length - 1];
}

export function vehicleTypeOf(key) {
  return VEHICLE_TYPES.find((s) => s.key === key) ?? null;
}
