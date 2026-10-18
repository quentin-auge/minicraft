# ARCHITECTURE.md

Agent guide to the MiniCraft static rewrite: what lives where, how data is
stored, how it flows, and how each system works. Read this before changing code.

## Tree

- `index.html` — static shell: menu (no backdrop veil, solid `#1c2030` panel like help), help (controls + portal diagrams), hotbar DOM, mega-ignition flash/veil overlays, portal-travel spiral overlay, Three.js import map.
- `main.js` — bootstrap: scene, input wiring, main loop, world startup. Owns the pause gate (`simActive`: locked + help closed + started + built): every sim/visual tick runs only behind it; the loader, the debug readout, and the final render run while paused. `X` is unbound; mega burns Firestorm Wall, ultra burns tornado + fat shock rings + wall + trimmed Titan smoke, countdown lights run one strobe swell (no style bindings); mega overlays decay on sim-time; dense mega FX, sliced carve jobs, and DPR dip run behind the gate (`fxDip` latches DPR 1 synchronously in `onExplode` — or early via `megaImminent()`, now also for lit ultras — so the blast frame itself renders cheap). Point-blank mega (camera inside R) fires full overlays + a camera-centered burst + max trauma + 5° FOV kick, then a furnace for the master blast clock only (`MEGA_BLAST_T` = 2.2 s — ember waves + crater burps + degressive veil floor while inside, stopping the moment you leave; inside/outside and R15/pool-of-20 all end on the same clock), trauma sustained at cap while inside. Outside the crater, overlays need voxel line of sight (`hasBlastLoS`) or they stay off — shake still goes through rock. Ultras reuse the same LoS overlay path with a fixed overlay, but keep band-front shake, no point-blank furnace, and unchanged band carve mechanics. `buildWorld` prewarms dense pools (scene-add + compile + one hidden render + reset) so blast #1 never compiles shaders. Ticks portals (fill refresh + loop travel) and notifies the portal index of blast edits.
- `src/ui/hotbar.js` — dynamic item list (add/remove/change/reset ops, selection tracked by id), rendered bar.
- `src/core/blocks.js` — block ids, BLOCK_INFO (solid/opaque/placeable, plus `light` emitter key for emissive blocks), liquid/TNT predicates.
- `src/core/noise.js` — deterministic hash2/valueNoise/fbm.
- `src/core/store.js` — voxel storage, one Map per dimension, column tops (plus moon-free bare tops for the enclosure fast path).
- `src/core/textures.js` — procedural canvas textures, per-block materials, liquid two-role surface materials, per-variant glowstone textures/materials, moon rock lit+emissive material.
- `src/render/blocklights.js` — pooled block-light backend (`LIGHT_EMITTERS` registry, glowstone first): per-spec cell clustering + sticky nearest assignment.
- `src/render/waterfog.js` — eye-in-liquid (or pocketed-air) fog/background murk while submerged.
- `src/render/sky.js` — high-altitude sky (day-to-black past the clouds, stars); rewrites the murk's air baseline. Reveal regions fade separately (regions.js).
- `src/render/regions.js` — reveal-region registry (`REGIONS`, moon first): each spec declares dimension, membership (`blocks` + `contains`), a camera-driven `factor` 0..1, and an optional `onFade` material hook; `regionOf` classifies a cell, `applyRegions` pushes factors each frame. Generic gating for any far body/structure — non-celestial volumes included.
- `src/world/overworld.js` — height field, rivers, terrain fill, generation orchestrator.
- `src/world/moon.js` — Moon disc + lake shafts (`MOON_MIN_Y`/`MOON_SURFACE_Y`/`MOON_R`/`MOON_THICK`, surface derived upward from the hand-picked bottom); `MOON_MIN_Y` doubles as the Moon reveal region's volume bound. Surface (cap + lakes) builds with the world (tops final before spawn); the hollow underside fills lazily after the reveal in row slices (`generateMoonUnderRows`, idempotent), then built disc chunks remesh via `refreshBlocks`; below the moon band the fill finishes synchronously.
- `src/world/glowstone.js` — glowstone color-variant registry (`GLOW_VARIANTS`, 7 entries), per-dimension variant maps + live block index, clustered placement picker (`glowVariantNear`: inherit within 10 blocks, else random).
- `src/world/clouds.js` — climbable cloud decks (`CLOUD_MIN_Y`/`CLOUD_MAX_Y` bounds plus `generateClouds`); spawn and sky reuse the bounds instead of hard-coding altitudes.
- `src/world/trees.js` — tree-type registry (`TREE_TYPES`, oak first), generic growth and ground guards.
- `src/render/flowers.js` — flower-variant registry, baked voxel-cluster geometries (stem/leaves/disc bloom). Per-block looks live in `world/flowers.js`; this module holds no placement state.
- `src/world/flowers.js` — per-dimension per-flower look memory (variant + Y angle, three-free): `noteFlowerPlace` draws a fresh weighted-random look at placement, the mesher only reads it back, `clearFlowerAt`/ `resetFlowerMemory` drop it on break/blast/new world.
- `src/world/village.js` — village layout and structure placement (houses, pen, pool); records worldgen-placed frame-block keys for the portal index (no full-map scan at build).
- `src/world/spawn.js` — spawn selection on finished voxels (`findSpawn`): firm open ground with a frustum-wide clear vista.
- `src/world/portals.js` — local-loop Nether/End portals: `PORTAL_TYPES` registry (End `PORTAL` frame, Nether `OBSIDIAN` frame; each spec carries frame block, sizes via anchors, fill color/material, travel action, help art — new families register a spec, the engine dispatches without family switches), frame validation (End 5×5/5×4 upright faces x/z + 5×5 flat, corners optional; Nether 5×4/4×5/4×4 upright faces x/z + 5×4/4×5 flat, corners required), interiors must be uniformly AIR or uniformly one liquid (anything else, including frame blocks, fails — solid slabs like the obsidian pool floor never validate), solid-color fills (End black, Nether purple, fogged like any block, always shown), body-overlap travel trigger, spiral + help-diagram builders, arrivals ~3 blocks out facing the crossed window. The spiral wait is a sim-time pending (`pendingTravel`, decremented in `tickPortals`), so pausing mid-spiral freezes it and the travel completes after unpausing; `tickPortals` freezes entirely (cooldown, scans, pending) while paused. Every edit refreshes fills around the edited cell the same frame (placement reach is unlimited, the player-centered scan alone would miss far windows).
- `src/player/physics.js` — player state, movement, shared axis movers (`collideBody`); `spawnPlayer` applies the `findSpawn` pick.
- `src/player/fly.js` — fly mode (pitch-aware thrust, no gravity) on the shared movers.
- `src/player/hook.js` — hook-kind registry (`HOOK_TYPES`, grapple first); framework (fire → pull → arrive/release) dispatches through the spec.
- `src/player/rope.js` — rope-render backend (instanced cube rope, swappable).
- `src/player/edit.js` — DDA raycast, place/break, floating-liquid purge, TNT displaced-liquid record. Notifies the portal index of every voxel change; glowstone places/breaks assign/clear the color variant and notify the block-light index.
- `src/fx/tnt.js` — blast-kind registry (`TNT_TYPES`, normal first), fuses, countdown visuals, delayed chain queue, spherical + pooled blasts, per-kind camera-shake specs, displaced-liquid memory, post-blast floating-liquid purge via injected callback. Chain dues are sim-time (`simNow`, advanced by `tickTNT`'s `dt`), so a pause freezes the cascade instead of firing it on resume. Second break-click detonates lit TNT at once. Blast deletions clear glowstone variants through the same `clearCell` choke point and re-sync block lights once per blast. Mega burns one style (Firestorm Wall, `MEGA_STYLE_KEY`); canonical mega phases live in shared builders (`MEGA_PHASES`: wall, tornado, rings, smoke) reused by ultra; countdown lights swell 12→own crater radius with the white heat (one light per pool member at its position, stragglers included via cluster membership; whole level for ultra bands) with physical falloff (decay 1), cutoff pushed to 1.6R so the bright edge lands on the crater rim instead of dying visibly short of it, locking on with a fixed white hold for the last 0.2 s; band spots step on fuse time (visible sweep across the whole level) with a near-black off-gate, and share a rescaled edge factor (16) and intensity cap (24000) for R271; pooled members share one union fireball at the centroid (radius = union bounding sphere capped at 64; density grows slightly with member count, hard-capped by the GPU pools) via a single `fxJobs` entry per pool (adaptive seed budget), one upload flush (`flushDense` with partial `updateRanges`) and one transient blast light. One ultra mix (tornado, fat shock rings ×1.4 radius / ×4 thickness / ×1.2 duration, wall, trimmed Titan smoke) chains whole canonical mega phases at `ULTRA_FULL_R` as one sim-time `fxJobs` entry per phase (`due`, drained in order under the adaptive budget, pause-safe; the smoke phase carries a `lifeScale` trimming its tail without touching the recipes), particles only (no mesh shells or flash spheres — `shells:false`, `shellMode:"off"`), one fixed overlay/light, unchanged band carve; ultra countdowns reuse the same light pipeline. `MEGA_BLAST_TIME_SCALE` (= 1) centralizes post-detonation lives/delays/flash expansion/blast light and the imported `MEGA_BLAST_T`; fuses stay 8 s. Even small pools skip synchronous remesh (cheap frame tracking + budgeted `bandPending` drain, 1–2 frames under the fireball). Big pools (over ~2600 columns) slice the carve into `carveJobs` (adaptive cols/tick, ~15 ticks for any size) and remesh through the budgeted `bandPending` drain instead of synchronous rebuilds; completion restores liquids, purges (Set-deduped), and tracks portal frames cheaply.
- `src/fx/particles.js` — generic burst/flash effects backend (`spawnBurst`, `spawnFlash`, `tickFx`) plus the dense mega engine: preallocated GPU-seeded pools (`spawnDense`: fire 48k / ember 12k / smoke 16k plus depth-tested occluded twins (`occlude:true` default, so blasts hide behind terrain; camera-lens furnace bursts pass `occlude:false`), zero per-frame CPU integration — one `uTime` uniform per frame, batched upload at `flushDense` with partial ranges, `defer:true` layers; distributions come from precomputed unit-sphere/ball/disc tables instead of per-particle trig), shapes (ball/shell/column/ring/rain/inward), instanced voxel debris (`spawnDebris`, one burst at a time), shared flash geometry, `tickDenseFx`/`denseFxActive`/`prewarmDenseFx` helpers (pools sleep invisible at zero live particles: no dense draws in steady state). Bursts support a crater-filling spawn ball (`fillRadius`), a per-particle color `palette`, and a `foreground` mode (no depth test, drawn above everything); flashes support a constant-speed `maxRadius` fireball mode (expand then vanish in a frame — pops never retract — duration scales with radius; giant ones render double-sided and unfogged).
- `src/fx/precip.js` — falling-precipitation backend (`PRECIP_TYPES` registry, snow first; rain later is one entry): camera-following drops at a 30 Hz step, wrap + cached landing heights, material fade-in over camera altitude. Its sway clock is the sim-time passed in by `main.js`, so snow freezes mid-air while paused.
- `src/render/mesher.js` — chunked InstancedMesh renderer, streaming, local refresh, region-aware instance splitting (per-id, per-variant glowstone, flowers, liquid quads all split by `regionOf`, each group owning cloned materials and gated by its region fade; generic per-region opacity fade so anything in a region — rock, placed blocks, glowstone, liquids — reveals smoothly, with the moon's `onFade` keeping the rock opaque and tinting sky-colour→texture; combined `regionVisible && veilVisible` so a hidden region never flashes a pocket veil).
- `src/ui/menu.js` — Play/Resume/New-World overlay, pointer-lock wiring (no saves). Play is clickable from the first frame and enters a finished world fading in through expanding fog; New World only once started and never during a build; Esc unlock shows Resume + New World. Boot builds instantly behind the menu; no spinner anywhere.
- `src/ui/debug.js` — `=` HUD readout (`fps N | x X  y Y  z Z`: FPS exponential moving average, quarter-second refresh, hidden until started; integer block coords are the floored feet position passed in from `main.js`).
- `src/ui/help.js` — help overlay open/close. Shortcut table: Move, Jump, Sprint, Place, Break, Select, Fly, Grapple, Help, Debug. Portal frame diagrams are painted by `portals.js` (`buildPortalDom` at boot).

## Data model

- Block ids are stable integers (`AIR = 0` … `MOON_WATER = 21`); new blocks only append.
- `BLOCK_INFO[id]` carries `solid`, `opaque`, `placeable`, and the `light` emitter key for emissive blocks (glowstone first). Physics and meshing both derive from it; block lights dispatch through it. `opaque` means fully occluding for meshing culls (PORTAL included — its texture is solid, so water sheets and neighbor faces cull against it instead of z-fighting at the contact).
- Voxel key: `(x + 1024) * 2^32 + y * 2048 + (z + 1024)` (decoded by `keyXYZ`, kept beside the encoder); one `Map` per dimension in `worlds`.
- No ceiling: columns run any `y >= 0` (floor `y = 0` bedrock stays); `dim`/`world` point at the active dimension's map and tops.
- Noise (`noise.js`) matches master's formulas exactly, including its z-flipped
  bilinear blend — required for a sane land/water ratio, do not "fix".
- `colTops[dim]` (Int32Array) tracks the highest non-air block per column for meshing and spawn; `colOcc[dim]` (`colIdx` → `Set` of occupied y) lets meshing iterate blocks instead of scanning height, and `colLiqTop[dim]` (`colIdx` → highest liquid y) answers swim queries in O(1) — all maintained by `setBlock`, plus the bulk `fillColumn` fast path used only by initial terrain fill (identical voxels and indexes, one bookkeeping pass per run).
- Village state is a single `village` object: center, bounds, houses, pen, pool, radius/houseCount tunables.
- Player state is module-level: `pos`/`vel` vectors, `yaw`/`pitch`, `onGround`,
  step-up/step-down flags, jump buffer/rebound trackers, shared `keys` map.
- Lit TNT lives in a `lit` map (`"x,y,z"` → fuse); chained blasts wait in a
  `pendingChain` map (`"x,y,z"` → due time); liquid displaced by placed TNT
  waits in a `displaced` map (`"x,y,z"` → liquid id, restored in that cell
  after its blast unless the kind clears liquids, cleared on world build); placed mega blocks are indexed in
  `megaIndex` for instant pool clustering (added on place, removed as blasts
   consume them, cleared on world build); the blast refresh callback and the
   post-blast floating-liquid purge (`onLiquidPurge`) are injected by the caller.
- Glowstone color lives in per-dimension variant maps (`"x,y,z"` key → variant index, default green) plus a live block index per dimension (clustering reads the stones, light buckets read the index — no world scans); placed stones inherit the nearest variant within 10 blocks, cleared on break/blast/world build.
- Flower looks live in per-dimension maps (`key(x,y,z)` → variant index + Y angle): every placement (worldgen scatter, player place) draws a fresh weighted-random variant and angle via `noteFlowerPlace`; the mesher only reads them back, so rebuilds never reshuffle a look; cleared on break/blast/world build.
- Render state: `chunkMeshes` (`"cx_cz"` → per-id InstancedMesh), a build queue,
  shared materials cache. Scene, camera, and renderer are owned by `main.js`.

## Data flow (generation)

`generateOverworld(seed)` runs one pipeline: seed → river paths → village layout
→ per-column terrain fill (flattened to stone inside village bounds, water below
`WATER_LEVEL`) → trees/flowers (flowers only on grass with air above, presence
hash-gated by `TERRAIN.flowerDensity`, each placed flower drawing a fresh
random variant + angle via `noteFlowerPlace`) → `placeVillage` structures. `generateClouds` scatters solid puff
clusters in the `CLOUD_MIN_Y`…`CLOUD_MAX_Y` band afterwards, then `generateMoonSurface` lays the rock cap
with hashed `MOON_WATER` lake shafts at `MOON_SURFACE_Y` (tops final before spawn). Spawn selection (`findSpawn`) closes the pipeline:
nearest firm open ground to the origin whose vista stays clear 50 blocks ahead
across the whole FOV swath and 12 rows above the eye — no wall, trunk, hillside,
or canopy anywhere in the frame. Pen cells excluded, liquids never qualify,
cloud decks and moon rock never qualify for footing (the scan starts below the moon band, so it stays fast).
The hollow underside shell fills after the reveal, not in the pipeline: `main.js` slices `generateMoonUnderRows` across idle frames (same geometry/salts as the eager port), then remeshes built disc chunks via `refreshBlocks` (`moonChunkCenters`; chunks streaming in later already contain the voxels). Below the moon band the fill finishes synchronously instead, so descending never meets an unbuilt shell.

## Data flow (meshing)

Per chunk: iterate each column's occupancy set (`colOcc`, ascending) and
keep exposed blocks only (any neighbor non-opaque), group by id
non-opaque), group by id into one InstancedMesh each (flowers skip the cube
bucket: per-variant cluster meshes with a stored random Y rotation, glass
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
Pocket detection is a bounded air-only flood with a colTop fast path for open sky: meshing (`isEnclosedAir`) counts budget exhaustion as open, so only small pockets veil; below the disc surface it escapes at the bare (moon-free) column tops instead, since moon rock pushes every top to ~946 and would otherwise force full-budget floods for all ground and lake-bottom air. The eye medium (`isEyePocketed`) adds a per-cell sky escape and counts budget exhaustion as pocketed, so big sealed halls keep veil gating (both veils hidden, pure blue) while the fog itself stays clear unless the eye is liquid. One `LIQUID_SURFACE` spec per
liquid in `textures.js` (defaults plus overrides, stable keys) supplies both
roles — color, opacity, and grain, so retinting never touches paint
code — new liquids register a spec without framework forks. Surfaces
stay unlit; glass draws last (renderOrder 13). Chunks within `RENDER_DIST` build nearest-first (3D distance to the
eye) under a
per-frame budget; edits rebuild only touching chunks via `refreshBlocks`. 3D
distances read cached per-chunk tops (dropped on rebuild/dispose) and the
clear-bubble guard scores the queue once, nearest-first. Columns walk
unsorted (instance order is invisible); meshes carry static conservative
spheres (no per-build computation, no per-frame matrix updates). Pocket/hem
tests memoize per air cell per build; steady-state region fades skip the
mesh and generic material loops (late-created materials fade at creation,
the bespoke `onFade` still runs). Non-region meshes share one group per
 chunk, fog-culled as a unit past fog far (the Moon ground content);
region meshes stay scene-level under their fade gate. The
first build is near-synchronous only: the spawn neighborhood meshes before
the first frame, then closed-in fog expands to reveal the world while far
chunks keep streaming in under the frame budget — invisible behind the fog,
and the clear-bubble guard builds anything entering visibility
synchronously, so nothing ever pops in.
Eviction waits for both the loose ring and the fogged range: a chunk outside
`RENDER_DIST + UNLOAD_MARGIN` disposes only once its slab also clears fog
far plus margin, and anything still queued inside the clear bubble builds
synchronously before the frame renders.

## Data flow (runtime)

`main.js` loop: always render + camera follow. Boot loads a world instantly
behind the translucent menu: voxels generate, the spawn neighborhood builds
synchronously, then closed-in fog (12–30) expands to its tuned range on a
smoothstep reveal while far chunks keep streaming in behind it — the reveal
stays pure fog motion over a solid neighborhood, never ghost clarify, and
the clear-bubble guard meshes anything entering visibility synchronously.
A tightening-only
runtime fog guard caps fog far by
the 3D distance to the nearest evictable slab (minus margin) and shrinks
the clear bubble with speed, so loading and unloading stay hidden at any
altitude or pace; the dive-murk baseline tracks the guard. The loop
ticks the high-altitude sky first (`sky.js`: black past the clouds, stars,
moon fading in over its approach band, never visible below), then
a light underwater murk after the build settles (`waterfog.js`,
eye-gated on the camera cell being liquid — divers murk with
the liquid's tint (per-liquid tint, fog 2–30), pocket and tunnel air stays
clear) plus the pocket-veil
eye-medium gate (liquid/diver, open air, pocket air, flipped only on change):
the only murk, since surfaces are flat unlit sheets. The eye medium is
computed once per frame and shared by the murk and the veil gate. Once voxel data exists, input is fully live — move, look,
place/break, grapple, fly, hotbar; edits
to unmeshed chunks persist in the voxel store and appear when their chunk
builds (`refreshBlocks` skips queued chunks, rebuilds built ones). Pause (`simActive`: locked and help closed) gates every sim and visual tick — player/hook/TNT/portals, particles, snow, block lights, fog, sky, regions, murk, shake — while the loader, the debug readout, and the final render keep running (see Pause contract). While active: movement (hook, else fly, else walk) → TNT tick → portal tick → raycast target + highlight → stream nearby chunks. Falling below `y = -20`
respawns. Portal windows refresh around the player (fills always exist but
fog like anything else); stepping into a fill plays the spiral, then respawns beside the
same window, ~3 blocks out and facing it) with a 1.5 s cooldown; pausing mid-spiral freezes the wait and the travel completes after unpausing. Play enters a finished world fading in through expanding fog; Esc
shows Resume + New World (fresh seed, same instant-load flow, the only action
that waits on a build). There is no
persistence.

## Pause contract

- Paused = pointer unlocked (menu) or help open. `main.js` computes one `simActive` (`worldReady && started && !building && isLocked() && !isHelpOpen()`) and every sim or visual tick runs only behind it: player/hook/knockback, `tickTNT`, `tickPortals`, `tickFx`, precip, block lights, hook visuals, streaming fog, sky, regions, dive murk, camera shake, highlight. Pausing freezes the frame; unpausing resumes it — nothing fires, decays, or catches up in between.
- Time-based logic takes `dt` plus sim-time only — never `performance.now`/`Date.now`/`setTimeout`/`setInterval` in a tick path. Pending futures are state + `dt` countdowns decremented in their tick: TNT chains (`pendingChain.due` off `simNow`), portal travel (`pendingTravel.t`), precip sway (sim-time passed in by `main.js`).
- Loader and UI-only code are the only wall-clock exemptions, named here so future agents don't "fix" them: chunk streaming/mesher budget + background moon fill (loading, not sim), `tickDebug` FPS readout, hotbar wheel throttle, `helpJustClosed` grace, toast/spiral DOM fades.
- New features ship pausable or they don't ship: wire every new `tick*`/`update*` behind `simActive`, keep every countdown in sim-time, and extend this section when adding a new exemption or pending-future shape.

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
  and sever paths are shared, with no physics changes. Grapple (middle-click or G, release to let go): any solid block (ground, wall, ceiling —
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
- TNT: first break-click on a TNT block lights its fuse with no remesh (block kept); normal shows a steady white countdown sprite (orange-red under 1 s), mega (blue block, id 22) an 8 s fuse with an accelerating blue-to-white veil pulse plus white heat and pooled lights, no number. A second break-click detonates lit TNT at once, notifying the portal index itself since no refresh callback is in play. Normal blasts clear a sphere (radius 3, open ball with the corner shell trimmed so the small crater reads round at the same reach) and chain neighbours with 50 ms delays, one flash/burst each. Megas link transitively at blast distance into one simultaneous pooled blast: upfront neighbor search over the live `megaIndex` (no voxel scans, clustering stays instant), +50% compound radius growth per neighbour within the member's current R/2 (cap 40, Ø80 ~= village diagonal), one crater + dense GPU fireball per member at its own radius (Firestorm Wall; big pools bloom in rolling sequence and slice the carve across frames), carve clamped to column tops. Normals caught in a pool go off instantly instead of cascading; a mega uncovered by a normal blast joins the pool. Ultras (black block, id 23) reuse the mega bucket countdown tinted black and wipe one altitude band of the whole level per blast — ground (1–90), cloud (91–`CLOUD_MAX_Y` + 1), moon (above, to the column top) by ignition height — carved as a radially-sorted column job under a fixed per-tick budget; carving only mutates voxels and records dirty chunks, while `drainBandRemesh` remeshes under a 6 ms budget nearest-first, gated on the carve frontier (a chunk rebuilds once its last touching column is carved, never twice; unbuilt chunks drop out for streaming), so even the ground band never freezes a frame. Portal frames track cheaply with fills healing from the dirty flag, floating liquids purge once at job end, and the spectacle is one persistent additive shell repositioned in place from the front radius (single draw call, no per-frame allocation) over a modest ignition flash; the renderer also dips to DPR 1 while a band carves. Fills hide at ignition and one full `scanWorldPortals` resync at job end removes every destroyed window's fill at any distance. Same-band lit fuses and queued blasts die with the band, cross-band lit ultras keep burning, and any carve uncovering an ultra queues its own band blast (ultras never pool). Each blast clears solid cells except bedrock (`y = 0`); liquids survive (blast passes through) unless the kind sets `clearsLiquids` — mega and ultra clear them and, placed in liquid, leave air behind instead of restoring it,
  while normal TNT restores the displaced liquid afterwards and placed in air leaves air behind.
  After every blast, liquid groups left with no solid neighbor are purged back to air. Player launch is one centroid shove per pooled blast (uniform 1.5R travel: ballistic arc on ground, decaying `knockVel` impulse along the mega→player line in fly, fly mode kept), plus camera shake out to 3R (max inside, linear to 2R, exponential to silence, via per-kind `shake` spec).
- Hotbar: dynamic list (add/remove/change/reset, selection by id) over 15 base overworld items (`GRASS` … `OBSIDIAN`, mega and ultra TNT always
  listed after normal TNT), texture-icon
  slots; wheel, `K`/`L`, and click all select with wraparound. Eight below the Moon's lower end the water slot becomes moon water and the flower slot becomes glowstone, restored on descent.

## Tuning (world specs, not constants)

- `TERRAIN`: land raise 20, basin (shore 1.5, depth 2.2), rivers (3 paths,
  step 36, width 6, bed 8), flower density 0.015. `WORLD_RADIUS = 96` and
  `WATER_LEVEL = 10` stay global.
- `VILLAGE_SPEC`: radius 28, 8 houses, pen 15×13, pool 8×6×2, pen pool
  2×2×1 (see `configureVillage` to grow).
- Spawn: feet inside radius 48, vista 50 ahead / 12 up across the FOV swath
  (`VIEW_HALF_TAN` from the 75° FOV), pen margin 1.
- Moon: bottom `MOON_MIN_Y` = 850 (hand-picked), surface `MOON_SURFACE_Y` = 946, radius 96, shell 5, 6 hashed lakes; surface (cap + lakes) builds with the world, hollow underside fills lazily in 16-row slices after the reveal plus chunk refresh, sync below `MOON_MIN_Y` - 8; low gravity from 850, toolbar flips 8 below at 842 (water→moon-water, flower→glowstone), sky black 475→495, the Moon reveal region fades 495→515 (disc, lakes, *and* every block placed at `y >= MOON_MIN_Y` — stones, dirt, flowers, liquids — fading together so blue sky never shows a moon-side silhouette or a popping glowstone), snow fades in over its gate span.
- Glowstone: 7 color variants, cluster inherit within 10 blocks else fresh random; unlit per-variant textures; pooled point lights (one entry per block, bounded nearest-16 in one pass, no distance cutoff, decay 2, intensity 150, 8/s position+color glide with snap at rest, 0.5 s sticky reassignment) that read on lit blocks (moon rock is Lambert + emissiveMap base ~0.85 so the underside stays readable; moon-water sheets stay unlit).
- Snow: 700 flakes, range 36, size 0.18, fall 2.5–5.5, 30 Hz step with landing heights refreshed every 8th step, hidden below its gate span, active above `MOON_SURFACE_Y - 8`.

## Tuning constants (player)

- `WALK = 4.4`, `SPRINT = 7.2`, `GRAVITY = 37.44`, `JUMP_MIN = 8.2`, `FLY = 10` (3x with sprint).
- Hook kinds: `HOOK_TYPES` (grapple: pull 26, fling 34, throw 70, retract 275, uniform boost 2, retract mini 0.08 s, eye 0.3, head 0, face gap 0.15, hang clear 0.6); new kinds register a spec.
- `JUMP_HOLD_TIME = 0.7`, `JUMP_THRUST = 45`, `JUMP_RAMP = 0.25`, `JUMP_BUFFER = 0.2`.
- Blast kinds: `TNT_TYPES` (normal: fuse 3.0, radius 3, `blastKind:"sphere"`, `countdownKind:"sprite"`, `fxKind:"burst"`, `chainDelay` 0.05; mega: fuse 8.0, radius 15/22.5/33.75 capped at 40 (`megaPoolRadius`: link at current R, growth per neighbours within current R/2, both transitively over a live mega index; carve clamped to column tops), `blastKind:"pooled"` (transitive simultaneous pool, one crater per member at its own radius plus a single union fireball at the centroid), `countdownKind:"bucket"` (veil + white heat + pooled lights swelling 12→own crater radius with the white heat, one physical-falloff light per pool member (cutoff 1.6R: bright edge on the crater rim, soft halo just outside) — whole-level range for ultra bands — + one telegraph shell per lit mega that grows 0.3→1.2 blocks over the last 3 s of fuse, no number; veil tint follows the mega kind), `fxKind:"mega"` via `spawnBlastFx` dispatching through `MEGA_PHASES` (wall; counts scale with R^3 via `denseCount`, capped by the GPU pools; the union fireball fills the full crater union), `knockback` (launch + shake out to 3R via per-kind `shake` spec, max inside, linear to 2R, exponential to 3R; ballistic arc on ground, decaying `knockVel` impulse along the mega→player line in fly) + one transient blast light + sim-time flash/veil overlays + DPR dip while `denseFxActive()`/`megaFxActive()`/`megaCarveActive()` (dip also anticipates via `megaImminent()` in the last 0.6 s of fuse), id 22; ultra: fuse 8.0, radius `ULTRA_FULL_R` (covers the level from any ignition), `blastKind:"band"` (one altitude band — ground 1–90, cloud 91–`CLOUD_MAX_Y` + 1, moon above to the column top, plus the band-1 tree-overhang flood — carved as a radially-sorted column job; dirty chunks remesh in `drainBandRemesh` under a 6 ms budget nearest-first, gated on the carve frontier), `countdownKind:"bucket"` tinted black via `countdownColor`, sharing the mega strobe/countdown-light pipeline, `fxKind:"ultra"` (`ULTRA_PHASES`: tornado, fat shock rings, wall, trimmed smoke chained at `ULTRA_FULL_R` via sim-time `fxJobs` dues; the band carve underneath is unchanged; fullscreen overlays reuse a fixed overlay under the same LoS rule), shake-only (`shake` max 1.5 at full reach, sustained via `bandFront()` while the camera sits inside the front), id 23); post-detonation mega/ultra timelines run through `MEGA_BLAST_TIME_SCALE` (= 1; `MEGA_BLAST_T` = 2.2 s), while fuses stay 8 s; new tiers register a spec.

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
- Region reveals: one factor band per region (Moon 495→515), generic material
  opacity fade owned per region (a region touching bespoke materials overrides
  them in its `onFade`).
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
  (`TREE_TYPES`, `FLOWER_VARIANTS`, `GLOW_VARIANTS`, `TNT_TYPES`, `HOOK_TYPES`, `PRECIP_TYPES`, `LIGHT_EMITTERS`, `REGIONS`).
- Shared properties live once in a module-local `*_DEFAULTS` object;
  entries spread it first and override only what differs.
- Differing numbers are entry properties; differing behavior is a
  capability flag the framework branches on (`pool`, `knockback`, `light`,
  `clearsLiquids`, `revealMaterials`, `pull`, `locomotion`) or an optional function prop (`carveBlast`,
  `spawnBlastFx`, `make/tick/clearLitVisual`, `grow`, `filter`, `contains`,
  `factor`, `onFade`, `tick`);
  kind strings (`key`, `blastKind`, `countdownKind`, `fxKind`) are stable
  identifiers, never branch conditions — dispatch goes through flags and
  hooks, or through a per-kind spec object looked up by key (e.g. camera
  shake via `shakeSpecFor(kind)`). Framework code never switches on kind
  names — new variants add entries (and any new flags/hooks they need),
  never forks.
- Spec keys are stable strings, never array indices, so a future save
  format survives reordering.
- Every tick-shaped hook (`tickLitVisual`, `spawnBlastFx`, precip `active`/`landed`, `LIGHT_EMITTERS` sync, `REGIONS` factor) obeys the Pause contract above: `dt` + sim-time in, no wall-clock out.
- Cosmetic variants follow the recipe: weighted options table → stored per-block look drawn at placement (`flowerVariantAt`/`flowerAngleAt` reads, `noteFlowerPlace` draws; `glowVariantAt`, clustered on place) → baked geometries/materials + shared material.

Single-anatomy numbers stay plain constants: world dimensions, body
physics, render budgets. Single-spec systems (`TERRAIN`, `VILLAGE_SPEC`) become registries only when a second variant arrives.

Shipped: trees (oak; pines later), flowers (7 variants), glowstone (7 color variants, clustered placement, pooled colored lights via `LIGHT_EMITTERS`), TNT (normal,
`blastKind:"sphere"`, `countdownKind:"sprite"`, `fxKind:"burst"`; mega,
`blastKind:"pooled"`, `countdownKind:"bucket"`, `fxKind:"mega"`, id 22; ultra,
`blastKind:"band"`, black bucket countdown, `fxKind:"ultra"`, id 23), hooks (grapple, `pull:"self-to-anchor"`;
grab later), liquids (water + moon-water outside/pocket roles), precip
(snow; rain later), portals
(`PORTAL_TYPES`: end frame `PORTAL`, nether frame `OBSIDIAN`, per-spec sizes,
fill, travel action, help art; local loop — arrivals respawn beside the same
window, dimensions later).
Specified, code-free: mobs (locomotion/perch/water/hookability axes),
`DIMENSIONS` (generator, env preset, spawn,
cleared flag + respawn policy, fly band, hazards, hotbar),
`BOSS_SPECS` (anchor dim, hp-as-hits, path builder, hit palette, weapon
interface, bar binding, death/cleared flag).

## Extension points (Nether/End)

- `worlds`/`colTops` already carry per-dimension maps; `setDimension` switches
  the active one. New dimensions add a generator module beside `overworld.js`.
- Block ids append-only; dimension-specific blocks slot into BLOCK_INFO.
- The hotbar list is dynamic (add/remove/change); band or dimension swaps go in `hotbar.js` callers.
- A distant body or occluded structure sharing a dimension's sky is a `REGIONS` entry (`contains` + `factor` + optional `onFade`), never a mesher fork.

## Dropped from master (kept out on purpose)

Saves and server API, mobs, jump streak boost, hold-chain
paint/bridge editing, Nether/End dimensions,
boss bar.
