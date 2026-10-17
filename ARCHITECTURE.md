# ARCHITECTURE.md

Agent guide to the MiniCraft static rewrite: what lives where, how data is
stored, how it flows, and how each system works. Read this before changing code.

## Tree

- `index.html` — static shell: menu, help, hotbar DOM, Three.js import map.
- `main.js` — bootstrap: scene, input wiring, main loop, world startup.
- `src/ui/hotbar.js` — full static item list, selection.
- `src/core/blocks.js` — block ids, BLOCK_INFO (solid/opaque/placeable), liquid/TNT predicates.
- `src/core/noise.js` — deterministic hash2/valueNoise/fbm.
- `src/core/store.js` — voxel storage, one Map per dimension, column tops.
- `src/core/textures.js` — procedural canvas textures, per-block materials, liquid two-role surface materials.
- `src/render/waterfog.js` — eye-in-liquid (or pocketed-air) fog/background murk while submerged.
- `src/world/overworld.js` — height field, rivers, terrain fill, generation orchestrator.
- `src/world/trees.js` — tree-type registry (`TREE_TYPES`, oak first), generic growth and ground guards.
- `src/render/flowers.js` — flower-variant registry, baked voxel-cluster geometries (stem/leaves/disc bloom).
- `src/world/village.js` — village layout and structure placement (houses, pen, pool).
- `src/world/spawn.js` — spawn selection on finished voxels (`findSpawn`): firm open ground with a frustum-wide clear vista.
- `src/player/physics.js` — player state, movement, shared axis movers (`collideBody`); `spawnPlayer` applies the `findSpawn` pick.
- `src/player/fly.js` — fly mode (pitch-aware thrust, no gravity) on the shared movers.
- `src/player/hook.js` — hook-kind registry (`HOOK_TYPES`, grapple first); framework (fire → pull → arrive/release) dispatches through the spec.
- `src/player/rope.js` — rope-render backend (instanced cube rope, swappable).
- `src/player/edit.js` — DDA raycast, place/break, floating-liquid purge, TNT displaced-liquid record.
- `src/fx/tnt.js` — blast-kind registry (`TNT_TYPES`, normal first), fuses, countdown sprite, delayed chain queue, spherical blasts, displaced-liquid memory. Second break-click detonates lit TNT at once.
- `src/fx/particles.js` — generic burst/flash effects backend (`spawnBurst`, `spawnFlash`, `tickFx`).
- `src/render/mesher.js` — chunked InstancedMesh renderer, streaming, local refresh.
- `src/ui/menu.js` — Play/Resume/New-World overlay, pointer-lock wiring (no saves). Play is clickable from the first frame and enters a finished world fading in through expanding fog; New World only once started and never during a build; Esc unlock shows Resume + New World. Boot builds instantly behind the menu; no spinner anywhere.
- `src/ui/debug.js` — `=` FPS readout (`fps~N`, exponential moving average, quarter-second refresh, hidden until started).
- `src/ui/help.js` — help overlay open/close. Shortcut table: Move, Jump, Sprint, Place, Break, Select, Fly, Grapple, Help, Debug.

## Data model

- Block ids are stable integers (`AIR = 0` … `MOON_WATER = 21`); new blocks only append.
- `BLOCK_INFO[id]` carries `solid`, `opaque`, `placeable`. Physics and meshing both derive from it.
- Voxel key: `(x + 1024) * 2048² + y * 2048 + (z + 1024)`; one `Map` per dimension in `worlds`.
- `MAX_Y = 256` world ceiling; `dim`/`world` point at the active dimension's map and tops.
- Noise (`noise.js`) matches master's formulas exactly, including its z-flipped
  bilinear blend — required for a sane land/water ratio, do not "fix".
- `colTops[dim]` (Int16Array) tracks the highest non-air block per column for meshing and spawn.
- Village state is a single `village` object: center, bounds, houses, pen, pool, radius/houseCount tunables.
- Player state is module-level: `pos`/`vel` vectors, `yaw`/`pitch`, `onGround`,
  step-up/step-down flags, jump buffer/rebound trackers, shared `keys` map.
- Lit TNT lives in a `lit` map (`"x,y,z"` → fuse); chained blasts wait in a
  `pendingChain` map (`"x,y,z"` → due time); liquid displaced by placed TNT
  waits in a `displaced` map (`"x,y,z"` → liquid id, restored in that cell
  after its blast, cleared on world build); the blast refresh callback is injected by the caller.
- Render state: `chunkMeshes` (`"cx_cz"` → per-id InstancedMesh), a build queue,
  shared materials cache. Scene, camera, and renderer are owned by `main.js`.

## Data flow (generation)

`generateOverworld(seed)` runs one pipeline: seed → river paths → village layout
→ per-column terrain fill (flattened to stone inside village bounds, water below
`WATER_LEVEL`) → trees/flowers (flowers only on grass with air above, hash-gated
by `TERRAIN.flowerDensity`) → `placeVillage` structures. Spawn selection (`findSpawn`) closes the pipeline:
nearest firm open ground to the origin whose vista stays clear 50 blocks ahead
across the whole FOV swath and 12 rows above the eye — no wall, trunk, hillside,
or canopy anywhere in the frame. Pen cells excluded, liquids never qualify.
No clouds, no moon.

## Data flow (meshing)

Per chunk: scan columns up to `colTops`, keep exposed blocks only (any neighbor
non-opaque), group by id into one InstancedMesh each (flowers skip the cube
bucket: per-variant cluster meshes with a hash-spun Y rotation, glass
transparent). Liquids skip cubes entirely: one merged InstancedMesh per
(liquid id, side) of full-block 1x1 boundary faces exactly on the cell
bounds. Faces against same-liquid or opaque neighbors are culled so adjacent
liquid merges into one volume and solid walls (wells, shores) show their own
faces; every bound emits the blue pair — an `outside` quad (`FrontSide`,
renderOrder 10; tops stronger via `topOpacity`, since they read against
bright ground showing through) plus a coplanar blue `inner` quad (`BackSide`,
renderOrder 11, same `outside` color/opacity) — so water reads regular blue
from everywhere and the original material is never replaced. Pocket bounds
(opposite-hemmed shaft air, enclosed bubbles) use depth-writing blue variants plus
gated white veils (renderOrder 12, after the blue): the near wall
depth-occludes the far wall, so each pocket shows exactly one face. One exception:
a surface liquid cell (open air above) with a broken sheet around it (air on
a side: player bumps, edges) also seals its column with a blue floor at the
foot of the exposed run (deepest same-liquid cell below the surface that
still sees lateral air, the lateral air followed down to its own foot), so
1-high and N-high bumps cap exactly the same plane and read solid from above
instead of showing the depths through
the transparent stack; the side air must sit on liquid, so well rims keep
regular water and shafts read hollow; unbroken sheet water stays merged. The
seal emits only the blue BackSide shutter: bumps read solid from above while
divers below see the uniform surface backs with no doubling rectangles. What
sits beneath neighboring air decides floors, laterally hemming air decides
veils: air on liquid gets a seal floor, air hemmed by the same
liquid on opposite same-level sides (or 3+ sides) or enclosed gets white
pocket veils over the unchanged blue pair, everything else stays plain blue
(diagonal L corners see liquid on two merely adjacent sides and stay plain
blue). Each viewpoint
sees exactly one blue sheet per quad (backface culling), so coplanar pairs
never z-fight, and stacked boundaries (water-air-water, air-water-air)
compose through blending in a fixed deterministic order instead of viewpoint
re-sorting, so nothing flickers. Pocket veils gate on the eye
medium via `setEyeMedium`: plain white (0.3, no ring patterns anywhere) shows
only while the eye sits inside the same liquid, always over its unchanged blue
backing, so every ring composites identically (uniform water filter, never bare
white on bright backdrops); the tinted veil (0.35, 0.65
toward the liquid color, `DoubleSide`) only while the eye sits in open air —
so divers see white, shore viewers see blue front faces plus light blue
(darker than diver white), and pocket interiors see pure blue. Veils emit on opposite-hemmed air (same liquid on
opposite same-level sides or 3+ sides: wells read like pockets from inside water, top ring included) or
enclosed air (bubbles); bumps, shores, diagonals, and sky stay blue, the opposition pair running before the flood so open air skips it. Only
pocket-bound sheets write depth; open-sea sheets never do, keeping shallows
see-through. Blue sheets are never gated.
Pocket detection is a bounded air-only flood with a colTop fast path for open sky: meshing (`isEnclosedAir`) counts budget exhaustion as open, so only small pockets veil; the eye medium (`isEyePocketed`) adds a per-cell sky escape and counts budget exhaustion as pocketed, so big sealed halls murk like divers instead of reading clear air. One `LIQUID_SURFACE` spec per
liquid in `textures.js` (defaults plus overrides, stable keys) supplies both
roles — color, opacity, and grain, so retinting never touches paint
code — new liquids register a spec without framework forks. Surfaces
stay unlit; glass draws last (renderOrder 13). Chunks within `RENDER_DIST` build nearest-first (3D distance to the
eye) under a
per-frame budget; edits rebuild only touching chunks via `refreshBlocks`. The
first build is fully synchronous: every chunk in range meshes before the
first frame, then closed-in fog expands to reveal the finished world.
Eviction waits for both the loose ring and the fogged range: a chunk outside
`RENDER_DIST + UNLOAD_MARGIN` disposes only once its slab also clears fog
far plus margin, and anything still queued inside the clear bubble builds
synchronously before the frame renders.

## Data flow (runtime)

`main.js` loop: always render + camera follow. Boot loads a world instantly
behind the translucent menu: voxels generate, every chunk in range builds
synchronously, then closed-in fog (12–30) expands to its tuned range on a
smoothstep reveal — the reveal is pure fog motion over a finished world,
never ghost clarify. A tightening-only runtime fog guard caps fog far by
the 3D distance to the nearest evictable slab (minus margin) and shrinks
the clear bubble with speed, so loading and unloading stay hidden at any
altitude or pace; the dive-murk baseline tracks the guard. The loop
ticks a light underwater murk after the build settles (`waterfog.js`,
eye-gated on the camera cell — divers and pocket-sitters murk alike with
the hemming liquid's tint, so pockets never see out clearer than divers do;
pockets stack a deeper tier (half range, stronger tint), like deeper water —
per-liquid tint, fog 2–30) plus the pocket-veil
eye-medium gate (liquid/diver, open air, pocket air, flipped only on change):
the only murk, since surfaces are flat unlit sheets. Once voxel data exists, input is fully live — move, look,
place/break, grapple, fly, hotbar; edits
to unmeshed chunks persist in the voxel store and appear when their chunk
builds (`refreshBlocks` skips queued chunks, rebuilds built ones). TNT
tick and simulation while locked and help closed (hook, else fly, else walk)
→ raycast target + highlight → stream nearby chunks. Falling below `y = -20`
respawns. Play enters a finished world fading in through expanding fog; Esc
shows Resume + New World (fresh seed, same instant-load flow, the only action
that waits on a build). There is no
persistence.

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
- Fly (`KeyF`): pitch-aware thrust through the shared axis movers
  (`collideBody` with stepping off), no gravity or swimming.
- Hook framework (`hook.js`): pick → filter → fly → pull → arrive/release →
  retract. `fireHookTarget` dispatches through the spec — no kind-name
  switches: the filter table resolves target kinds to anchors, and the
  active `HOOK_TYPES` entry supplies speeds, pull mode, ghost, and retarget.
  A mob grab adds a filter entry (`{ kind: "mob", ref }` from a mob picker)
  plus a kind entry with `pull: "anchor-to-self"` and a following `retarget`
  (anchor tracks `mob.pos` + offset every frame, flight included); release
  and sever paths are shared, with no physics changes. Grapple (middle-click): any solid block (ground, wall, ceiling —
  never liquid), unbounded DDA pick (`Infinity`, 1024 steps, like edit picks), eye anchor `0.3`; refused while flying, hooked, or in fly
  mode. Head flies parametric (`fly 0→1` at `throw × boost`) onto the aimed
  face plane (`headOff` 0: cube centered on the surface, half-buried), physics live underneath so falls continue. The
  pull owns the frame (dispatched through `spec.pull`: velocity toward the
  landing, substepped collision +
  slide), ghosts the anchor column only for top landings (`topLand`: stack
  rides up to stand on top; taller faces land in the free cell before the
  hit); stalls stop in place after 3 stuck frames. Arrivals stop dead (next
  jump is plain): top hooks stand plane-locked (`hookPlanar` — walk/swim
  horizontally, gravity on drops, never up: no jump, rebound, or auto-step;
  `hookWet` arrivals sink, dry ones float), face hooks hang frozen, jump
  inert, until mouse-up plain-drops. Face arrivals back off the aimed face
  (`arriveGap` along the outward normal, when it fits) so the latched cube
  clears the body; bottom faces dangle to a fixed cube-to-eye clearance
  (`hangClear`) so the mark reads looking up; top landings snap exact. Mid-pull release flings at 34 along the
  launch direction (26 in liquid); other releases just retract boosted
  (`retract × boost`) at the plain head speed, slowed to last `retractMinTime`
  when close, the mark detaching from
  the anchor with the head so nothing stays welded on the face. Rope stays
  pinned until mouse-up; teleports sever it
  silently (`severHook` on out-of-level respawn and New World). Pinned visual
  is the mark alone, half-buried in the surface (dark head cube + 4 rope squares in a
  cross lying on the face) while still against the arrival point, plus the
  S-wobble eye→anchor rope from the first step away until mouse-up,
  clamped above its segment (level walks read clean; drops and bumps off
  the segment may clip); flight, pull, and retract draw the wobbling thin rope. All
  depth-tested, walls occlude normally.
  refused while flying, cancelled by fly toggle.
- Editing: DDA raycast (Left = place, Right = break) with a highlight target
   and unlimited reach across the world (grapple picker unbounded too).
   Placement targeting passes through liquids except when a liquid is selected
   (`isLiquid`) and the eye is outside liquid — then the first hit wins (liquid
   or solid); break and grapple always skip liquids. First break-click on TNT lights its fuse with no remesh (block kept); a second break-click on lit TNT detonates it at once.
  Live edits purge floating liquid: any
  same-liquid group left without a solid 6-neighbor returns to air. Bedrock
  (`y = 0`) and liquids are unbreakable; solid placement refuses the player's
  own AABB.
- TNT: first break-click on a TNT block lights a 3 s fuse, shown as a
  world-space countdown sprite (white, orange-red under 1 s, exponential-chirp
  blink 1→14 Hz, no block remesh during the countdown); a second break-click
  detonates it immediately. The blast clears a sphere (radius 4) except
  liquids, which survive while the blast passes through them, throws a
  yellow flash plus a 64-point burst, and queues neighboring TNT for delayed
  chain blasts (50 ms apart, one flash/burst each). A TNT placed in liquid restores that exact liquid in its own
  cell after its blast; placed in air it leaves air behind.
- Hotbar: 13 placeable overworld items (`GRASS` … `OBSIDIAN`), texture-icon
  slots; wheel, `K`/`L`, and click all select with wraparound.

## Tuning (world specs, not constants)

- `TERRAIN`: land raise 20, basin (shore 1.5, depth 2.2), rivers (3 paths,
  step 36, width 6, bed 8), flower density 0.015. `WORLD_RADIUS = 96` and
  `WATER_LEVEL = 10` stay global.
- `VILLAGE_SPEC`: radius 28, 8 houses, pen 15×13, pool 8×6×2, pen pool
  2×2×1 (see `configureVillage` to grow).
- Spawn: feet inside radius 48, vista 50 ahead / 12 up across the FOV swath
  (`VIEW_HALF_TAN` from the 75° FOV), pen margin 1.

## Tuning constants (player)

- `WALK = 4.4`, `SPRINT = 7.2`, `GRAVITY = 37.44`, `JUMP_MIN = 8.2`, `FLY = 10` (3x with sprint).
- Hook kinds: `HOOK_TYPES` (grapple: pull 26, fling 34, throw 70, retract 275, uniform boost 2, retract mini 0.08 s, eye 0.3, head 0, face gap 0.15, hang clear 0.6); new kinds register a spec.
- `JUMP_HOLD_TIME = 0.7`, `JUMP_THRUST = 45`, `JUMP_RAMP = 0.25`, `JUMP_BUFFER = 0.2`.
- Blast kinds: `TNT_TYPES` (normal: fuse 3.0, radius 4, `blastKind:"sphere"`, `countdownKind:"sprite"`, `fxKind:"burst"`, `chainDelay` 0.05; mega/ultra later as entries with `blastKind` `pooled`/`band`, `countdownKind` `bucket`, `fxKind` `mega`/`ultra`, ids 22/23); new tiers register a spec.

## Tuning constants (render)

- `CHUNK = 16`, `RENDER_DIST = 8`, chunk build budget 6 ms/frame, spawn sync radius 3. Unload lags
  load by three rings (`UNLOAD_MARGIN = 3`, free: the rings clip to the
  finite world) and past the fogged range
  (`DISPOSE_MARGIN = 10` beyond fog far, 3D slab distance), so border
  crossings never pop; anything queued inside the clear bubble builds
  synchronously before the frame renders.
- Fog 60–160, sky `#87ceeb`, sun + hemisphere lighting. Fog far stays inside
  the nearest evictable slab distance at any altitude (tightening-only guard
  caps it by the 3D unload distance minus margin, clear bubble shrinks 20%
  at full sprint speed), so loading chunks debut fully fogged and evicted
  chunks are fully fogged first. First load builds everything synchronously,
  then closed-in fog (12–30) expands over `REVEAL_MS = 1200`.
- Liquid surfaces: unlit two-role sheets (blue 0.7 / top 0.9 on both sides,
  orders 10/11; pocket bounds use depth-writing blue + veils order 12: plain
  white 0.3 gated to divers over unchanged blue backs / plain light-blue 0.35 tinted 0.65 for open-air
  eyes, hidden in pocket air; glass 13) plus
  per-liquid dive murk (fog 2–30, tint 0.55; pocketed eyes stack a deeper tier: fog 1–15, tint 0.75). Blue sheets stay always on; veils flip only on eye-medium
  change (`POCKET_FLOOD_LIMIT = 512`).

## Extension pattern

Every variant family follows the same shape — new variants are registry
entries, never framework forks:

- One exported registry array of spec objects, each with a `key`
  (`TREE_TYPES`, `FLOWER_VARIANTS`, `TNT_TYPES`, `HOOK_TYPES`).
- Shared properties live once in a module-local `*_DEFAULTS` object;
  entries spread it first and override only what differs.
- Differing numbers are entry properties; differing behavior is a
  capability flag the framework branches on (`pull`, `blastKind`,
  `countdownKind`, `fxKind`, `locomotion`) or an optional function prop
  (`grow`, `filter`, `tick`, `carveBlast`, `spawnBlastFx`, `*LitVisual`).
  Framework code never switches on kind names — it dispatches through
  the spec.
- Spec keys are stable strings, never array indices, so a future save
  format survives reordering.
- Cosmetic variants follow the recipe: weighted options table → deterministic
  hash picker (`flowerVariantAt`) → baked geometries + shared material.

Single-anatomy numbers stay plain constants: world dimensions, body
physics, render budgets. Single-spec systems (`TERRAIN`, `VILLAGE_SPEC`) become registries only when a second variant arrives.

Shipped: trees (oak; pines later), flowers (7 variants), TNT (normal,
`blastKind:"sphere"`, `countdownKind:"sprite"`, `fxKind:"burst"`; mega/ultra
later as entries, ids 22/23), hooks (grapple, `pull:"self-to-anchor"`;
grab later), liquids (water outside-blue + pocket-white roles).
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
- The hotbar is a static list today; dimension swaps (if wanted) go in `hotbar.js`.

## Dropped from master (kept out on purpose)

Saves and server API, mobs, jump streak boost, hold-chain
paint/bridge editing, clouds/moon, portals,
boss bar.
