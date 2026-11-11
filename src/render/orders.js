// Transparent-pass compositing bands, one source of truth. Three.js renders
// the opaque pass first, then sorts transparent objects by renderOrder
// ascending (then back-to-front). A transparent surface that writes depth
// erases every transparent fragment drawn after it, so the ladder below is
// ordered by dependency, not aesthetics:
//   liquids first (the world's see-through content),
//   then motes riding their surface,
//   then glass (composites over water from either side),
//   then vehicle parts (the hull must never erase the world it flies over —
//   the rocket fade is translucency, not occlusion).
// Later bands may write depth; earlier ones are already composited.
export const ORDERS = {
  LIQUID_OUTSIDE: 10,
  LIQUID_INSIDE: 11,
  MOTE: 12,
  GLASS: 13,
  VEHICLE: 14,
  VEHICLE_GLASS: 15,
  VEHICLE_FX: 16,
};
