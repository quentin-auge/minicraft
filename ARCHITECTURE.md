# ARCHITECTURE.md

Agent guide to the MiniCraft static rewrite: what lives where, how data is
stored, how it flows, and how each system works. Read this before changing code.

## Tree

- `index.html` — static shell: menu, help, hotbar DOM, Three.js import map.
- `main.js` — bootstrap: scene, input wiring, main loop, world startup.
- `src/core/blocks.js` — block ids, BLOCK_INFO (solid/opaque/placeable), liquid/TNT predicates.
- `src/core/noise.js` — deterministic hash2/valueNoise/fbm.
- `src/core/store.js` — voxel storage, one Map per dimension, column tops.
- `src/core/textures.js` — procedural canvas textures, per-block materials.
- `src/world/overworld.js` — height field, rivers, terrain fill, generation orchestrator.
- `src/world/trees.js` — tree-type registry (`TREE_TYPES`, oak first), generic growth and ground guards.
- `src/render/flowers.js` — flower-variant registry, baked voxel-cluster geometries (stem/leaves/disc bloom).
- `src/world/village.js` — village layout and structure placement (houses, pen, pool).
- `src/world/spawn.js` — spawn selection on finished voxels (`findSpawn`): firm open ground with a frustum-wide clear vista.
- `src/player/physics.js` — player state, movement, shared axis movers (`collideBody`); `spawnPlayer` applies the `findSpawn` pick.

## Data model

- Block ids are stable integers (`AIR = 0` … `ULTRA_TNT = 23`); new blocks only append.
- `BLOCK_INFO[id]` carries `solid`, `opaque`, `placeable`. Physics and meshing both derive from it.
- Voxel key: `(x + 1024) * 2048² + y * 2048 + (z + 1024)`; one `Map` per dimension in `worlds`.
- `MAX_Y = 256` world ceiling; `dim`/`world` point at the active dimension's map and tops.
- Noise (`noise.js`) matches master's formulas exactly, including its z-flipped
  bilinear blend — required for a sane land/water ratio, do not "fix".
- `colTops[dim]` (Int16Array) tracks the highest non-air block per column for meshing and spawn.
- Village state is a single `village` object: center, bounds, houses, pen, pool, radius/houseCount tunables.
- Player state is module-level: `pos`/`vel` vectors, `yaw`/`pitch`, `onGround`,
  step-up/step-down flags, jump buffer/rebound trackers, shared `keys` map.

## Data flow (generation)

`generateOverworld(seed)` runs one pipeline: seed → river paths → village layout
→ per-column terrain fill (flattened to stone inside village bounds, water below
`WATER_LEVEL`) → trees/flowers (flowers only on grass with air above, hash-gated
by `TERRAIN.flowerDensity`) → `placeVillage` structures. Spawn selection (`findSpawn`) closes the pipeline:
nearest firm open ground to the origin whose vista stays clear 50 blocks ahead
across the whole FOV swath and 12 rows above the eye — no wall, trunk, hillside,
or canopy anywhere in the frame. Pen cells excluded, liquids never qualify.
No clouds, no moon.

## Broad logic (world)

- Height field: base + hills + roughness, plateau bands, sea-level clamp, basin
  seas, river-bed carving. `heightAt` memoizes per column.
- Village: flat-ish site search, pen/pool/houses placed with mutual avoidance.
- Trees: `TREE_TYPES` registry (oak: trunk 4–35 from `hash2(seed+999)`, round
  canopy). Shared properties live in `TREE_DEFAULTS`; entries override only
  what differs, and the trunk roll is generic over `trunkMin`/`trunkMax`.
  `tryGrowTree` rolls each type's density, then enforces ground-only
  guards: grass, above the waterline, river-bank margin, slope tolerance.
  New types register a spec; the placement loop is type-agnostic.

## Broad logic (player)

- Movement is a ground/swim state machine. Ground: walk/sprint speeds, held-jump
  thrust with ramp and boost, jump buffer, air steering. One-block steps climb
  automatically via `tryStep` (glide to `stepUpClearY`); walking off edges sets
  `stepDown` for smooth descent.
- Water: swim toward surface-drift speed with deep accel and near-surface brake;
  jumping toward water while holding jump rebounds ballistically to the jump's
  start height. No jump streak speed boost.

## Tuning (world specs, not constants)

- `TERRAIN`: land raise 20, basin (shore 1.5, depth 2.2), rivers (3 paths,
  step 36, width 6, bed 8), flower density 0.015. `WORLD_RADIUS = 96` and
  `WATER_LEVEL = 10` stay global.
- `VILLAGE_SPEC`: radius 28, 8 houses, pen 15×13, pool 8×6×2, pen pool
  2×2×1 (see `configureVillage` to grow).
- Spawn: feet inside radius 48, vista 50 ahead / 12 up across the FOV swath
  (`VIEW_HALF_TAN` from the 75° FOV), pen margin 1.

## Tuning constants (player)

- `WALK = 4.4`, `SPRINT = 7.2`, `GRAVITY = 37.44`, `JUMP_MIN = 8.2`.
- `JUMP_HOLD_TIME = 0.7`, `JUMP_THRUST = 45`, `JUMP_RAMP = 0.25`, `JUMP_BUFFER = 0.2`.

## Tuning constants (render)

- `CHUNK = 16`, `RENDER_DIST = 8`.
- Fog 60–160, sky `#87ceeb`, sun + hemisphere lighting.

## Extension pattern

Every variant family follows the same shape — new variants are registry
entries, never framework forks:

- One exported registry array of spec objects, each with a `key`
  (`TREE_TYPES`, `FLOWER_VARIANTS`; TNT and hooks follow in their commits).
- Shared properties live once in a module-local `*_DEFAULTS` object;
  entries spread it first and override only what differs.
- Differing numbers are entry properties; differing behavior is a
  capability flag the framework branches on (`pull`, `blastMode`,
  `locomotion`) or an optional function prop (`grow`, `filter`, `tick`).
  Framework code never switches on kind names — it dispatches through
  the spec.
- Spec keys are stable strings, never array indices, so a future save
  format survives reordering.
- Cosmetic variants follow the recipe: weighted options table → deterministic
  hash picker (`flowerVariantAt`) → baked geometries + shared material.

Single-anatomy numbers stay plain constants: world dimensions, body
physics, render budgets. Single-spec systems (`TERRAIN`, `VILLAGE_SPEC`) become registries only when a second variant arrives.

Shipped here: trees (oak; pines later), flowers (7 variants).
Specified, code-free: mobs (locomotion/perch/water/hookability axes),
`PORTAL_TYPES` (frame block, sizes, fill material, sealed-when rule,
arrival mapper, mob policy), `DIMENSIONS` (generator, env preset, spawn,
cleared flag + respawn policy, fly band, hazards, hotbar),
`BOSS_SPECS` (anchor dim, hp-as-hits, path builder, hit palette, weapon
interface, bar binding, death/cleared flag).

## Extension points (Nether/End)

- `worlds`/`colTops` already carry per-dimension maps; `setDimension` switches
  the active one. New dimensions add a generator module beside `overworld.js`.
- Block ids append-only; dimension-specific blocks slot into BLOCK_INFO.

## Dropped from master (kept out on purpose)

Saves and server API, mobs, grapple, jump streak boost, hold-chain
paint/bridge editing, clouds/moon, portals,
boss bar.

