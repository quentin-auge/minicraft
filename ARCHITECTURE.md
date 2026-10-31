# ARCHITECTURE.md

Agent guide to the MiniCraft static rewrite: what lives where, how data is
stored, how it flows, and how each system works. Read this before changing code.

## Tree

- `index.html` — static shell: menu (no backdrop veil, solid `#1c2030` panel like help), help (controls + portal diagrams), hotbar DOM (incl. master's unlock-pop keyframes), Ender Dragon boss bar, mega-ignition flash/veil overlays, portal-travel spiral overlay, Three.js import map.
- `main.js` — bootstrap (`?test=1` loads the test instrumentation hook, inert unless set): scene, input wiring, main loop, world startup. Owns the pause gate (`simActive`: locked + help closed + started + built): every sim/visual tick runs only behind it; the loader, the fog reveal, the debug readout, and the final render run while paused. Mob behavior is fully baked in (balanced pen setup, no tuning keys); `V` (cheat only) cycles the world simulation speed (×1/×2/×4/×8/×16, wrapping) through `sdt`, while player/camera/chain/loader keep real `dt`; mega burns Firestorm Wall, ultra burns tornado + fat shock rings + wall + trimmed Titan smoke, countdown lights run one strobe swell (no style bindings); mega overlays decay on sim-time; dense mega FX, sliced carve jobs, and DPR dip run behind the gate (`fxDip` latches DPR 1 synchronously in `onExplode` — or early via `megaImminent()`, now also for lit ultras — so the blast frame itself renders cheap). Point-blank mega (camera inside R) fires full overlays + a camera-centered burst + max trauma + 5° FOV kick, then a furnace for the master blast clock only (`MEGA_BLAST_T` = 2.2 s — ember waves + crater burps + degressive veil floor while inside, stopping the moment you leave; inside/outside and R15/pool-of-20 all end on the same clock), trauma sustained at cap while inside. Outside the crater, overlays need voxel line of sight (`hasBlastLoS`) or they stay off — shake still goes through rock. Ultras reuse the same LoS overlay path with a fixed overlay, but keep band-front shake, no point-blank furnace, and unchanged carve mechanics. `buildWorld` slices voxel gen across frames (`generateOverworldAsync`, 12 rows/slice, token-aborted), builds the spawn neighborhood (radius 2), then the loop enters the game on the first rendered world frame (`pendingPlay`: the Play click only arms entry plus a best-effort lock) while the fog reveal (`tickReveal`, per-frame, loader-exempt) expands underneath and far chunks stream in; dense-pool warmup (scene-add + compile + reset, no hidden render) runs post-unlock. Ticks portals (fill refresh + cross-dimension travel handoff to `runTravel`) and notifies the portal index of blast edits. Travel loads its destination behind the spiral in two phases (`runTravel`: sliced scene teardown under the fade-in (`beginDispose`/`disposeSome`, ~80 chunks/slice, queue cleared last so no half-torn key ever drains), then destination voxels with no mesher calls, then a full-ring budgeted mesh drain capped ~1.5 s in short slices with an extra yield after heavy ones + fill refresh + shader compile once per dimension per session (`compileAsync`: synchronous link + async poll, skipped once the set linked — GL programs persist in the context)); the spiral paints before any heavy work, the canvas freezes behind the opaque overlay, and at lift the fog snaps straight to its final range with the reveal marked done — ready to go, no arrival hitch, no reveal, no visible streaming (cap fallback, e.g. deep Nether: the missing-chunk guard hides unbuilt distance without holes). Cross-dim switches regenerate the End and the TNT cube, retain the overworld and the Nether, resolve the arrival through the portal last left in the destination (visibility-first placement, else the dimension spawn), reset meshes/fills/lights/fuses, and keep fly mode on. Overworld ground spawns (boot, New World, fall respawns) apply `applySpawn()`: a spec may carry `pitch`/`fly`, and the overworld spec returns the pen overwatch (16 blocks above the pen, looking straight down, fly on); portal arrivals keep their own spot. A dragon kill increments the TNT tier progression, rescans portal fills, and rebuilds the bar in place so newly unlocked tiers reveal immediately; New World resets kills (see `tntunlock.js`).
- `src/ui/hotbar.js` — dynamic item list (add/remove/change/reset ops, selection tracked by id), rendered bar. `resetItems(to)` swaps the whole list (slot icons memoized per block id, so re-bars skip the re-encode); the active dimension's `dimHotbar` picks it (overworld base set, TNT tiers only, End substitutes Moon Water and Glowstone for water and flower, locked mega/ultra filtered), so travel and fresh builds re-bar and selection follows by id. `resetItems(to, popId)` pops only that one item with master's `unlock-pop`/`slotPop` (gold border, scale, glow), dropping the class on `animationend`; dimension travel, New World, and every other bar change rebuild silently.
- `src/core/blocks.js` — block ids, BLOCK_INFO (solid/opaque/placeable, plus `light` emitter key for emissive blocks), liquid/TNT predicates.
- `src/core/noise.js` — deterministic hash2/valueNoise/fbm.
- `src/core/store.js` — voxel storage, one Map per dimension keyed by `DIMENSION_KEYS` (`over`/`tnt`/`end` live, `nether` reserved), sparse column tops (plus moon-free bare tops for the enclosure fast path), and per-dimension protected-cell sets used by Endstone and the generated return frame. Key packing covers ±65535 on every axis; `registerInfiniteDim` lifts the ±96 cube (and the y = 0 floor) per dimension — the TNT sky roams free, bounded dims keep the exact old bounds.
- `src/core/cheat.js` — cheat flag (`?cheat=1`, session-fixed): bypasses the TNT tier locks and enables the Z dimension cycle (over → end → nether → tnt).
- `src/core/textures.js` — procedural canvas textures, including the master Endstone palette, per-block materials, liquid two-role surface materials, per-variant glowstone textures/materials, moon rock lit+emissive material.
- `src/render/halobake.js` — baked-halo registry (`HALO_SOURCES`): every source tints the opaque blocks around its positions at chunk-build time (mesher `setColorAt`, white = untouched), permanently and level-wide, so all sources read lit instead of a max of the nearest ones; sources self-register beside their data (glowstone everywhere, portal frames Nether-only in family colors), new families add a spec and nothing else changes. Per-spec suspension (`setHaloSuspended`, tracked per chunk as `suspendedBuilt` in `mesher.js`): still-hold bridge strokes suspend the glowstone halo and freeze pool-light resyncs, and the touched union plus chunks built under suspension re-queue through the budgeted drain on bridge release for the tint pass.
- `src/render/poollights.js` — selective dynamic pool: one lamp per glowstone cluster fitting in a 5×5×5 cube (groups connected past a Chebyshev gap of GAP = 3, transitively, so dotted lines read as one group; a lone stone is a cluster of one; the lamp floats at the centroid, colored by the centroid-nearest stone), plus one lamp per grid-plane crossing on sprawling chains (invisible planes every GRID blocks on x, y and z; lamps spaced at least GRID apart within a chain so a chain lying in a plane lights every GRID blocks); spots carry block keys so lamps never migrate on camera motion or unrelated edits; eligibility has hysteresis (enter at DIST, leave past 1.2×DIST); nearest-first fill to SPOT_BUDGET (16) — past 16 spots only the nearest burn; every validated Nether portal and every sited tunnel ring burns one centered lamp with no cap (`portalFrameLights` + `netherRingLights`); ring cells are excluded from clusters via `isNetherRingCell`; snap only, no glide; halo stays the base layer everywhere.
- `src/render/chainproxy.js` — optimistic overlay for chain edits: transient per-id `InstancedMesh` in the blocks' own shared materials (cubes + per-variant glowstone; liquids/flowers stay on the normal path), fed by `proxyNote` each tick and culled by chunk rebuild versions (`mesher.js chunkVersion`) with an 8 s sim-time TTL backstop; cleared on world build and dimension travel.
- `src/render/waterfog.js` — eye-in-liquid (or pocketed-air) fog/background murk while submerged.
- `src/fx/ambient.js` — ambient-effect registry (`AMBIENT`, keyed by a dimension spec's `ambient`): lazy init/tick/exit per dimension switch, never leftover particles.
- `src/fx/nether.js` — Nether ambience: lava-sea embers, volcano eruption fountains, camera-local blue motes while the eye is submerged in lava. Fountain spawns are gated on live crater lava at the spawn cell, so eruptions die with a blasted volcano instead of firing from air (sea embers self-gate the same way on the lava surface).
- `src/world/nether.js` — three-free, stream-first Nether generator: great lava sea with big rugged fbm islands (master's terrain recipe, capped for fan cooperation), winding lava rivers, two hollow fully-closed corner volcanoes with a central lava column on a flat summit, constant-section falls draping over island relief into the sea, 10 stratified high fan tunnels per volcano to the column plus three ground bridge pipes per volcano (tips 5..15 blocks clear of the flank, each landing on its own shelf islet or right on flat island relief), glowstone portal rings sized on the carved mouth with rock collar, doorstep and trimmed approaches, protected return platform; lava-ban mask for O(1) siting vetoes; `setupNether` (one keyed entry per pass via `netherSetupStages`, shared by the sync reference and the sliced paths; the tunnel-siting entry slices within its attempt sweeps through an async twin — the draw RNG is pure-hash, so yields change no trial, verified bit-identical headless) + `generateNetherChunk` via `registerChunkSource("nether")`, `prepareNetherDimensionAsync` boot path (yields between setup stages and platform chunks, so a first visit never holds one long block).
- `src/render/sky.js` — high-altitude sky (per-dimension base colour from the active `DIMENSIONS` env — day blue overworld, pale dusty-rose TNT (red TNT reads dark against it at every distance) — fading to black past the clouds with stars only where the env keeps space (overworld; TNT sets `space: false`); the `SKY_DOMES` registry builds each env `dome` lazily and follows the camera (the Nether's dusk gradient, stars and orange sun disc)); rewrites the murk's air baseline. Reveal regions fade separately (regions.js).
- `src/render/regions.js` — reveal-region registry (`REGIONS`, moon first): each spec declares dimension, membership (`blocks` + `contains`), a camera-driven `factor` 0..1, and an optional `onFade` material hook; `regionOf` classifies a cell, `applyRegions` pushes factors each frame. Generic gating for any far body/structure — non-celestial volumes included.
- `src/world/overworld.js` — height field, rivers, terrain fill, generation orchestrator (`generateOverworld` sync for tests/headless; `generateOverworldAsync` identical voxels in 12-row slices with `requestAnimationFrame` yields and token abort). Terrain columns bottom out at the dimension's floor level (`floorY`, threaded from the spec).
- `src/world/dimensions.js` — first-class dimension registry (`DIMENSIONS`: generator, env preset, spawn, `arrival` portal-return policy, `hotbar` bar list, `persistence` retain/regenerate, respawn policy, floor level (`floorY`: `0`, `null` = floorless), `exitsGate`/`exitsGateMsg` portal lock (End: while the dragon lives no portal ferries the player out — `portals.js` dispatches through it), `infinite` voxel streaming + `respawnY` floor (`null` = none — the TNT sky has none), `tntTiersUnlocked` (the TNT sky ignores the dragon-kill tier locks)). Overworld and Nether retain voxels; End and TNT regenerate every entry (reusing the pinned `?seed=` session seed when present, fresh roll otherwise). `persistence` alone drives the portal-entry wipe of all per-dimension side state — voxels, glowstone variants/index, flower looks, placed-TNT index, and that dim's mobs (`farm.js handleFarmTravel`): retain keeps everything across trips, regenerate rebuilds everything fresh, so future dimensions inherit the rule with no travel-code fork. Every registered dimension key is a valid `?startdim=<key>` boot target, plus the `moon` alias: overworld boot with the lunar spawn (`findMoonSpawn`), later respawns using the ground spawn. Each spec's `arrival` drives portal returns (`portal` resolves the window last left there, facing it in the Overworld and putting the player's back to it everywhere else; `spawn` uses findSpawn, as in the portal-less TNT sky). `dimHotbar` filters locked mega/ultra per dimension and `dimTntTiersUnlocked` exposes the exemption; `?cheat=1` forces both tiers everywhere.
- `src/world/end.js` — End platform generation and boss progression: protected Endstone square (-36…36 on X/Z), protected return portal frame, End spawn, and the cleared flag that gates the return portal fill. Per-entry resets never touch the cumulative TNT unlock kills (`tntunlock.js`).
- `src/world/tntdim.js` — TNT dimension: legacy bounded clouds-only `193x193x192` cube (same XZ as overworld, `y 1-192`, no floor; still the headless reference) plus the clip-free placer (`placeCloudAt`, `CLOUD_R_MAX`) the streaming lattice reuses, one tier per cloud (all `TNT` or all `MEGA_TNT`, never ultra), compact ellipsoid puffs on a two-phase 3D scatter: 8 sparse megas first, then up to 80 regulars filling every safe pocket (regulars only need 3+margin from each other). Core rule (never violated, enforced constructively + asserted): no blast may reach another cloud — pairwise edge gap must exceed the largest applicable blast radius (40 for any mega-involved pair since mega pools cap at 40 and chain normals, 3 for normal–normal) plus a tier-split per-pair margin from the seed hash (flat 1% for mega-involved pairs, 5–20% for normal–normal) (`blastIsolationNeed` + `pairMargin`); spacing uses each cloud's own bounding radius, so clouds sit as close as the rule allows. Single pale dusty-rose sky (`TNT_ENV`, `space: false` — never black, no stars); `findTntSpawn` stands on regular TNT with headroom.
- `src/world/tntunlock.js` — TNT tier progression: mega unlocks at 2 Ender Dragon kills, ultra at 3 (`UNLOCK_KILLS`), counted per world and reset by New World; `?cheat=1` bypasses every lock for the session. Pure state + predicates (`noteDragonKill` returns the tier this kill unlocked, for the hotbar pop; `resetTntUnlocks`, `isLockedTntTier`, `isTntTierUnlocked`); the TNT dimension ignores the locks, and the bar/placement gates dispatch through these.
- `src/world/tntstream.js` — infinite TNT sky: deterministic 3D cell lattice (normals pitch 48, megas pitch 96 with a `MEGA_PROB` per-super-cell roll — the rarity rate, currently 0.6 for ~10 megas per fog sphere typically, 1.0 fills every super-cell, the structural maximum — spawn's own super-cell mega-free; each mega sterilizes ~20 normal cells, so at 1.0 the sky reads mega-dominated at ~1:25 normals:megas, lower rates trade megas for surviving reds) streamed around the player (nearest-missing cells under a velocity-scaled tick budget — demand pi·R²·v/cell³ at the 80 b/s 2x-gravity design fall, floor 4 cells, 5 ms cap, one batched remesh per tick — plus a 3x3 fall shaft to GEN_R + |vy|·3s while diving, mesh-horizon pre-fill in entry slices, evict past 2×fog + 96 and 15 s unseen), pristine regen from the entry seed, player-pinned cells (edits, portal frames, hook anchor) never evict, sky-grapple synth clouds (≤800, `skyGrapple` capability) checked against deterministic neighbours with nearest-mega fallback, spawn hunts neighbour cells for a standable top when its home cell holes, hardcoded point as the final fallback. No safety net: the sky falls forever (the ±65535 key range is the structural floor).
- `src/world/moon.js` — Moon disc + lake shafts (`MOON_MIN_Y`/`MOON_SURFACE_Y`/`MOON_R`/`MOON_THICK`, surface derived upward from the hand-picked bottom) + `findMoonSpawn` (nearest-to-origin solid cap outside lake shafts, facing the origin); `MOON_MIN_Y` doubles as the Moon reveal region's volume bound. Surface (cap + lakes) builds with the world (tops final before spawn); the hollow underside fills lazily after the reveal in row slices (`generateMoonUnderRows`, idempotent, never seals lake water so shafts stay open below), then built disc chunks remesh via `refreshBlocks`; below the moon band the fill finishes synchronously. All Moon voxel writes run only in `dim === "over"` — the lazy fill and the safety net abort on travel elsewhere and the fill resumes on return, so the TNT cube never receives moon voxels (its reveal region is dim-gated too).
- `src/world/glowstone.js` — glowstone color-variant registry (`GLOW_VARIANTS`, 7 entries), per-dimension variant maps + live block index, clustered placement picker (`glowVariantNear`: inherit within 10 blocks, else seeded draw via `setGlowSeed`), baked-halo source registration (every stone tints its neighbors).
- `src/world/clouds.js` — puff-cluster builder (`generateCloudClusters`: layers/count/salts/puff sizes injected, block chosen per cluster) plus the overworld climbable-deck specialization (`CLOUD_MIN_Y`/`CLOUD_MAX_Y` bounds plus `generateClouds`); spawn and sky reuse the bounds instead of hard-coding altitudes. The TNT dimension reuses the same puff math in compact form (see `tntdim.js`).
- `src/world/trees.js` — tree-type registry (`TREE_TYPES`, oak first), generic growth and ground guards.
- `src/render/flowers.js` — flower-variant registry, baked voxel-cluster geometries (stem/leaves/disc bloom). Per-block looks live in `world/flowers.js`; this module holds no placement state.
- `src/world/flowers.js` — per-dimension per-flower look memory (variant + Y angle, three-free): `noteFlowerPlace` draws a fresh seeded weighted-random look at placement (`setFlowerSeed`), the mesher only reads it back, `clearFlowerAt`/ `resetFlowerMemory` drop it on break/blast/new world.
- `src/world/village.js` — village layout and structure placement (houses, pen, pool); records worldgen-placed frame-block keys for the portal index (no full-map scan at build); doorstep leveling (`levelHouse`: sill row, 2-cell apron, and interior floor to the village height with 3-high headroom — terrain and vegetation only, neighbours/pen/pool skipped — so every house door walks both ways).
- `src/world/spawn.js` — overworld spawn selection on finished voxels (`findSpawn`): firm open ground with a frustum-wide clear vista. Column scans stop at the dimension's floor level. TNT spawn lives in `tntdim.js` (`findTntSpawn`); `physics.js spawnPlayer` dispatches through the active `DIMENSIONS` spec.
- `src/mobs/registry.js` — stable-key `MOB_TYPES` registry with locomotion capability flags (`walk`/`jump`/`float`/`swim`/`fly`: `float` is passive surface buoyancy, `swim` directed underwater locomotion), homing-TNT targeting flags, create/tick/damage/dispose hooks, and optional `aimHitTest` dispatch. Flying mobs default to homing-TNT targeting and a three-shot volley cap; specs may override either capability or cap.
- `src/mobs/homing.js` — shared TNT target acquisition, block occlusion, per-target volley locks, homing impact projectiles, and mob-damage dispatch. Uses each type's precise aim test when provided; reserves the damage of all live shots against a target's remaining health, preventing overkill shots. The dragon has no volley cap but cannot reserve more than its eight hits.
- `src/mobs/corridor.js` — three-free path policy: cardinal snap, free-distance raycasts, width-aware `classifyExits` through the mover's unified blocked predicate (forward/backward are raw body-fit openings; sides count only when they branch — mouth walks plus far run or broken wall continuity — so a followed lane never reads as a junction), `junctionOptions` (every open dir except the entry way: random branch, no U-turn — draws come from the mob's own `jrng` stream, seeded once from the ambient rand on first servo tick, so roam refactors never reshuffle junction outcomes), and the `updateLane` state machine (engage/cruise/junction/lock-turn/uturn). A locked junction cell still U-turns when nothing stays open besides the entry way (dead end right past the turn); straight cruise heals a stale entry back to the way behind, so a later straight cell never coin-flips a backtrack and only true junctions randomize. Also owns the shared 8-wind compass (`WINDS8` + `snap8`): every lane-less heading snaps to one of 8 winds so meetings read off a discrete set (the servo stays cardinal-only). Pure and headless-tested.
- `src/mobs/step.js` — shared step physics (R0, three-free): collision probes, the single occupancy predicate (`fitsAt`: body box, support, footing, headroom, plus the nose circle when asked — drives always ask, direction sensing follows the collide.js mode), `noseReach` (snout protrusion + nose radius, the one anatomy number every forward distance consumes), the pit guard (`descendOk`: no step down into a local minimum without a walkable same-level continuation — pits read as walls, ramps and liquid entries pass through), stride validation (`segmentWalkable` + `strideTarget`, so pen fence, house walls, and troughs bound targets emergently with no pen fork; `strideTarget` measures the body clearance along the heading and draws the reach from it (`STRIDE_FLOOR` 0.8 to clearance minus the collide.js mode margin — 0 in A, 0.2 in B — capped at `WANDER_MAX` 10 — short in pens, long in open ground), and takes an optional `blocked(x, z)` veto so mob-aware picks refuse strides ending on another mob exactly like walls — passing near peers stays legal), turn/move primitives (turn-rate `turnTo`, axis-separated `moveClamped`, vector `moveVector`, `landUnwedged`, and the unified gated drive `driveToward` behind the funnel, the roam commit, and the wander fallback), the shared lane teardown (`dropLane`), and shared constants (`SPIN`, `VIRTUAL_W`, wander span, turn rate `TURN_RATE` 3). The junction stream (`spawnRng`, one per mob) lives here too.
- `src/mobs/gaps.js` — the single bounded-hole scan (R5): a run counts only when walled on both flanks, running on along the axis, with walkable lateral transit — side mouths never qualify, so junction corners stay blended and parallel corridors never read as gaps. Returns `{axis, line, center, dist, heading}`; give-up + cooldown bound any wedge.
- `src/mobs/grid.js` — spatial hash for mobs (three-free, pure): one Map built per tick (`buildMobGrid`, cell 3 m), XZ queries (`queryMobGrid`) that are radius supersets of each caller's exact skip, so grid results are bit-identical to full scans — only faster. Deterministic (insertion order + fixed cell iteration); order-sensitive consumers re-sort by `_peerIdx`.
- `src/mobs/forecast.js` — group predictive planner (three-free, pure): every tick, lane-less mobs reserve space-time along 8-wind trajectories most-blocked-first (`stuckT` desc, `_peerIdx` tiebreak); advisory only — overrides solely on predicted contact deeper than `GATE_ALLOW` inside the 0.7 s engage window, free roam and shallow brushes otherwise, narrowest free wind first at full speed; forced plans latch (`PLAN_HOLD` 1.5 s, dropped on expiry/hard wall/straight-line-free, never on brushes). A forced wind persists across hold drops while walkable (sticky) but an episode never re-deals: once the last dodge goes invalid the mob holds its commit line on reactive behavior only, until the line reads free — unless the line itself runs into a wall (`wallAhead` at planner scale: horizon plus nose reach), which re-deals, since static geometry converges where peer flicker never does and the near-wall turn keeps snouts off walls. Episode memory (`_prevForce`, capped `STICK_T` 2 s) clears the moment the straight line frees, so no stale line survives it. Voxels read only inside the wall horizon plus the nose reach, so the warning precedes snout contact in both unification modes. Only forced maneuvers snap to the 8-wind; free roam/wander stays raw.
- `src/mobs/collide.js` — collision unification (three-free, no imports): two nose policies — A puts the nose in every `fitsAt` decision (strides may end at nose contact), B keeps the body rule with the nose lookahead in the planner read (shipped default; the headless rigs pin modes directly to cover both). `noseReach` is the single anatomy constant.
- `src/mobs/mover.js` — three-free farm-mob kinematics: the 1-wide servo (corridor-axis cruise with locked yaw, timed entry→exit corner blend, dead-end nose-to-wall seek then in-place U-turn, stall-guard release, doorway gap funnel; the single `slideLateral` serves every lane event and every cruise tick — follow-line middle modulo-π or cell centre — so blend arcs exit centred, the dead-end seek recentres first, and corner wedges unstick), gravity/float vertical with support-top landing snap, and open-field mob cooperation (lane-less ticks only; the servo keeps exact legacy behavior): CPA-based temporal yield (`predictCPA`, `avoidMobs` — slow only, never steer/stop), a step gate refusing overlaps past the `GATE_ALLOW` 0.05 brush budget (`mobBlockedAt`, exact detection at 0 for picks/walls), stuck wiggle-then-detour on the 8-wind (`WIGGLE_DIST` 0.5 ×2 max keeping the gaining side, then 1–2.4 m goal-relative sidesteps held up to `DETOUR_SPAN` 1.5 s — both nose-tip validated like free strides, so maneuvers never commit where the nose-aware drive won't go), plus a progress watchdog (two 0.5 s samples without closing escalate like stillness: committed pushes in open field, a fresh wall-aware re-decide within snout-sweep range of walls), and the hard separation backstop (worst circle-pair first, up to 8 iterations, grid-rebuilt per iteration, bit-identical to full scan). Forced plan headings are already 8-wind snapped at plan time and never override a flying maneuver (the slowdown still applies, so maneuvers sequence temporally); free roam/wander drives keep the raw heading. The R2 follow-line upkeep runs at the top of every servo tick; the funnel, roam commit, and wander fallback share the unified gated drive (`driveToward`). `farm.js` owns meshes/lifecycle and injects `pickTarget` (stride validation lives in `step.js`); headless rigs drive this module on live voxels.
- `src/mobs/roam.js` — three-free directional roam for everything outside servo lanes (no positional servo: heading/target decisions only). One commit shape (8-wind headings — cardinals plus diagonals — with 0.5 m free, validated distant target, 2–8 s spans; free way ahead keeps its heading, turns always need an obstacle), cruised open-loop on the latched heading — never re-aimed at the point, so micro-moves can't orbit the yaw, overshoots can't spin it 180°, and arrivals need no terminal nudge — arriving at `ARRIVE_D` 0.2 or passing the target within `PASS_LAT` 0.8 of the line, wall rides that latch a virtual follow line (slide target only, probes stay real; session rides latched by decide are time-boxed and turn away at the span, under-lane biases live and die with the lane), the shared gap scan as tiebreak (explore mode), and open-space release committing straight out with the current heading bias. `roamStep` takes an optional mob-body veto plus a forced plan heading (one-tick group override, drive only); `openHeading` commits with 0.5 m clearance (roomiest above 0.3 m) so commits reach walls instead of demanding ballroom space; when the winning heading takes no stride, `decide` tries the siblings in order before the picker, so commits stay obstacle-driven and a null picker can never freeze the mob; `decide` forwards the mob's own `rand` everywhere so free-roam stays deterministic. Stuck re-picks at 0.5 s everywhere, dropping an identical re-pick so the refresh hands `decide` a fresh commit.
- `src/mobs/livestock.js` — three-free farm-livestock specs (`LIVESTOCK_SPECS`: master-true pig/cow body plans as data for the generic quadruped builder; `PIG_COUNT`/`COW_COUNT` 4+4, per-type `drop` 1, `MOB_FLOAT_FRAC` 1/3 submerged, `FARM_WALK_DIVISOR` 2.2) plus the deterministic pen policy: `isStrictPenCell` (fence interior only, never trough water/rim), seeded `pickPenSpawns` (8 pairwise-separated spots), `floatTargetY`, `dropAllowed` (legal-step predicate), `specCircles` (body circles from the visual spec: core hw, nose/tail along+r from part extents, h from the highest part).
- `src/mobs/farm.js` — pig/cow specializations: generic `buildQuadruped(spec)` meshes,   `enter/clear/tickFarmMobs` lifecycle, anchor-free wander (random heading + clearance-fitted strides validated end-to-end — destination rules plus the whole segment via `strideTarget`, so pen fence, house walls, and troughs bound targets emergently with no pen fork; wall-push stuck detection re-picks at 0.5 s, so a breach gets used). Legal steps for non-jumping walkers: never up, down at most the per-type `drop` (pig/cow 1, `dropAllowed` in `livestock.js`); deeper drops are vertical air walls rejected like solid. Every descent falls with gravity; landing snaps to the support top so feet stay exact and chained drops read true (no hover); support counts only when a solid top touches the feet (footprint rule, so descents walk clear of the lip then fall with gravity), so falls never freeze mid-air; airborne bodies keep walking while the fall stays within the per-type `drop`, deeper falls go straight down with no void sailing; the landing snap only settles onto a free spot, else a facing-first `landUnwedged` search shifts to one (supported preferred); floating bodies bypass the drop gate, with no water-exit rescue. Steps move axis-separated with clamp-by-halving against the blocker, and the nose-circle probe ahead along the facing keeps the visual head out of walls (open-field wander; the 1-wide servo drives body-only instead — the body is already the widest part, and any nose reach rakes chicane corners into stops — with core-column void sensing, so solid and air walls stay one predicate). 1-wide paths (walled left AND right, solid or drop) cruise their corridor centre with locked yaw plus a lateral centre slide (no hunting, no spurious turns); L/T/cross turns blend entry→exit on a fixed swing (no spin-stop), picking a random exit excluding the entry way with a same-cell lock against re-picks (zigzags chain naturally); everything else runs on roam headings (commit to open directions, wall-follow lanes, gap tiebreaks — never a positional servo, so wide lanes hug walls instead of gliding to the middle); path mouths and rooms release back to roam once no axis reads constrained; dead ends seek nose-to-wall, then U-turn in place (the only U-turn); wedged lanes and funnels give up instead of freezing. Air walls use the same body-circle footprint everywhere (steps, pushes, drift, landing: `footingOk` requires the core+nose columns over ground within the per-type `drop` (the decorative tail never leads a step, so it stays out of the void probes — a tail over a dead-end back wall must not veto walking out), with headroom per column), so no anatomy hangs over an illegal drop. Mob-vs-mob runs in three phases per tick (`tickFarmMobs`): one spatial hash (`buildMobGrid`, cell 3) feeding the advisory group plan (`planGroup`) off live positions most-blocked-first, per-mob ticks consuming one-tick forced plans (yield floors the pairwise slow), then the hard separation backstop (`separateFarmMobs`, worst circle-pair first, up to 8 iterations, grid-rebuilt per iteration). Mob-aware picks refuse strides ending on another mob with a `PICK_COMFORT` 0.3 margin (destination cell only — passing near peers stays legal); the step gate itself brushes through contact within the 0.15 m crossing budget and refuses deeper overlap like a wall, so herds sequence instead of grinding. The group planner crosses on the direct line (slowed) whenever the whole-horizon brush stays within that same budget, sidestepping only deep head-on contact; stuck patience (`STUCK_T` 0.5 s), engage window (`ENGAGE_T` 0.7 s), yield floor/range (`YIELD_SLOW`/`YIELD_DIST`), and plan hold (`PLAN_HOLD` 1.5 s) are plain constants; a vetoed separation side stays put while the other side takes the full correction, y-gated (`SEP_Y` 1.2), `SEP_GAP` 0.1 extra on every circle-pair need (exact overlaps unstack along a deterministic pair-index fallback instead of stalling); the veto enforces the legal-drop rule too, so pushes treat deep drops as air walls exactly like steps and herds never shove each other off cliffs. Debug `spawnFarmMobAt` drops a random pig/cow at the crosshair (B, cheat only, any dimension, free-roaming; body box plus nose circle validated over 4 yaw tries, rising while blocked). Types are dimension-agnostic; the pen is only the default point supplier, and portal travel wipes/follows per-dim mobs through the destination spec's `persistence` (`handleFarmTravel`: retain keeps, regenerate clears).
- `src/mobs/end.js` — End specializations: master-style block-built Ender Dragon, six body-attached linked tail segments (~67% longer than the original geometry) with tip details parented to the moving end, slightly slimmer plain dark double-sided wing membranes with dark-purple ribs, and rendered-geometry TNT aiming across body, head, tail, ribs, and membranes; eight-hit health, looping flight, directional breath bursts at random 2–6 s intervals, chained hit colors, 1.5 s amplified sideways death shake and large particle-only death cloud. Ten Endermen teleport when gazed at, and teleport out when a voxel change buries their body or removes their footing (AABB/solid overlap test plus support scan; arrivals validate a free body-sized volume on solid ground at `topAt` height, so towers work; `main.js` notifies after discrete, chain, and blast edits, and the tick re-checks as a safety net — `edit.js` never calls in, since `end.js` already imports `pickBlock` from it). Mob ticks obey the main simulation pause gate. The dragon's final death counts one kill through `noteDragonKill` before the victory hook runs.
- `src/world/portals.js` — destination-driven portals: `PORTAL_TYPES` registry (End `PORTAL` frame, Nether `OBSIDIAN` frame, TNT frame set `TNT`/`MEGA_TNT`/`ULTRA_TNT`; each spec carries its frame block(s), sizes via anchors, fill color/material, destination dimension, travel action, help art, spiral color — new families register a spec, the engine dispatches without family switches), frame validation (End 5×5/5×4 upright faces x/z + 5×5 flat, corners optional; Nether 5×4/4×5/4×4 upright faces x/z + 5×4/4×5 flat, corners required; TNT 4×4 upright faces x/z + 4×4 flat, corners required, ring all TNT tiers with at least one mega and one ultra) — Nether and TNT share the generic rectangular-frame geometry (`dims`-tagged `rectFillCells`/`rectBBox`/`insideRectInterior`), interiors must be uniformly AIR or uniformly one liquid (anything else, including frame blocks, fails — solid slabs like the obsidian pool floor never validate), solid-color fills (End black, Nether purple, TNT red, fogged like any block; shown unless the active dimension's `exitsGate` is closed — under a closed gate no family gets a fill, existing ones purge and touch answers the gate instead), body-overlap travel trigger (also reached by grappling a fill: `pickPortalFill` ray-tests the live slabs for the hook — meshes, not blocks, so the block DDA flies through them — and `portalWindowLive` guards mid-flight liveness, `portalGhostCell` makes the frame ring passable to the pull so arrival lands inside the slab), spiral + help-diagram builders (every spec's `art.cells` matrix paints its frame cell-by-cell with real block-texture icons — `materialsFor` data URLs; End/Nether use a solid ring via `buildSolidFrame`, TNT a shuffled 4/4/4 tier mix via `buildTntFrame`, rendered smaller through `art.width`), arrivals are visibility-first: orthogonal spots from the face/side centre at distances `4,5,3,6,2,7,1,8`, each sweeping small lateral offsets with height `0/+1/+2` above the frame base (neither lateral offset nor height counts in the distance), both faces/sides with the recorded exit direction first — per distance, the portal's own ground level sweeps every face and side before any other height, going to the other side beats climbing — then the same sweep snapped to each column's real support top (`-1,-2,+3,-3,+4` around the frame base, for sunk, raised or sloped portals); every candidate needs standable ground, body clearance against every solid block, no portal interior, and LOS to the portal (upright windows accept the fill face centre, then any fill cell nearest-first, then the nearest ring faces as a last resort so a floating portal stays landable from below; flat ones use their nearest ring cells, side face then top face, so the ring top reads over any single-step obstacle). Flat interiors are bounded to the fill layer (no infinite vertical column), so a high or deep cell near a neighbouring flat portal is no longer rejected. Then the player stands on the closest real frame block that fits, then any visible standable spot within 16 blocks of the frame bbox. Unlinked Nether arrivals anchor on the destination spawn (spawn first, then resolve), so the generated return portal is used instead of a blind spawn. Overworld arrivals face the portal; every other dimension arrives with its back to it. Cross-dimension exits record the source window per dimension (`travelLinks`); an arrival in that dimension resolves the recorded window when it still validates, so A→B→A returns to the exact portal left in A whatever portal carried the player back. End and TNT regenerate every entry (no portal persistence besides the End's generated return frame), TNT spawns on a cloud without a portal, and Nether travel crosses dimensions like the other families, arriving through the destination's last-window portal (back to it, like the End). The main-loop hook swaps worlds, applies the resolved arrival (else the dimension spawn), and `completeDimTravel` releases the spiral. Frame sets and fills are per-dimension. Fly persists across all portal travel — only the hook severs. Fill slabs fade in over 0.35 s on a transient cloned material (`tickPortalFillFades`, loader-exempt, snapped past fog far, purged on removal) instead of popping. The spiral wait is a sim-time pending (`pendingTravel`, decremented in `tickPortals`), so pausing mid-spiral freezes it and the travel completes after unpausing; `tickPortals` freezes entirely (cooldown, scans, pending) while paused. Every edit refreshes fills around the edited cell the same frame (placement reach is unlimited, the player-centered scan alone would miss far windows).
- End travel specialization: an End frame enters the End from any dimension; an End frame in the End returns to Overworld only while the dragon-cleared gate is open — and while it is closed the dimension's `exitsGate` gates every portal in the End (End frames, Nether loops, TNT crossings alike): no fills exist anywhere, travel is refused, and touching any validated window (tracked in `portalWindows`, fill-backed or not) answers the gate message once per entry, re-armed after leaving the interior, outside the travel cooldown; the dragon-victory hook's full scan (`scanWorldPortals`) lights every fill the moment it opens. The generated return frame and platform cells are protected from edits and TNT blasts.
- `src/player/physics.js` — player state, movement, shared axis movers (`collideBody`), the shared look-relative thrust used by Fly and the held-grapple swim (`thrustMove`/`updateFreeSwim`), and liquid helpers (body-span `headInWaterAt` tests candidate landings for the pull; `eyeInWater` accepts a held-swim move outright, otherwise only non-ascending moves pass so the eye never rises into air; `eyeDeepInWater` marks the free zone below the surface cell); `spawnPlayer` applies the `findSpawn` pick.
- `src/player/fly.js` — fly mode (pitch-aware thrust, no gravity) on the shared movers. Persists across all portal travel (switches never touch `flyOn`).
- `src/player/hook.js` — hook-kind registry (`HOOK_TYPES`, grapple first); framework (fire → pull → arrive/release) dispatches through the spec. `fireSkyHook` (dimensions with the `skyGrapple` capability — TNT only today): a DDA miss materializes a lattice cloud past the fog (≤800) and latches it through the normal block filter; refusals match a regular shot. Portal fills grapple too: `grapplePick` takes the nearer of the block DDA and the live fill slabs, and `TARGET_FILTERS.portal` lands the player at the fill center so the normal touch-travel fires on arrival. Targets may override their kind spec's retarget/ghost/alive at the hook level (fills do — static anchor, frame-ring ghost, window liveness). Anchor liveness severs the hook everywhere: a mined, blasted, or evicted anchor (block cell gone solid, fill window dead) retracts instead of pulling to empty air. A settled hook with the body in liquid swims while held, wherever the shot came from: look-driven 3D movement, a dry eye sinks back under the surface, the eye never rises into air (no jumping out), any anchor face, while the grapple is held. The top submerged cell floats, deeper cells swim freely; portal anchors keep travel rules; dry settles freeze until release.
- `src/player/rope.js` — rope-render backend (instanced cube rope, swappable).
- `src/player/edit.js` — DDA raycast, place/break, floating-liquid purge, TNT displaced-liquid record. The floor level (`floorY`, read via `dimFloorY`) is unbreakable by hand in every dimension that has one (`0` in overworld/End/Nether, `null` in the floorless TNT sky); the TNT cube has no floor. Notifies the portal index of every voxel change; glowstone places/breaks assign/clear the color variant and notify the block-light index. Player-placed regular TNT is indexed for mega crater-boundary chain detection. `tryPlace` refuses locked mega/ultra outside the TNT dimension (direct and chain paths); locked tiers are already absent from those bars. Raycasts run to the key range in infinite dims (`outOfWorld`); player edits pin their stream cell against eviction, and `tryPlace` builds below zero there. Batched chain path (`opts.batch` + `flushChainBatch`): skips per-cell purge/portal/light work, flushed once per tick over the cell union.
- `src/player/chain.js` — hold-chain editing rules (ported from master): `CHAIN_SPEC` thresholds (incl. `movePx`/`bridgeStillPx` 15px raw-travel gates), `AnchorStore` (range-4 history, buckets cleared on press/release only), sweep sampler, `CHAIN_MODES` (paint / bridge / dig-sweep / dig-hold) + `BRIDGE_STEPPERS` (arrival / spiral / plateau) registries, `feetDest`/`lineStep`/`chainPad`/`chainSpiral`, `tickChain(dt, ctx)` on sim-time with master's dead times and acceleration, capped at 2 steps/frame. `chainBridgeActive` (left held + stairs latched) is the bridge-vs-chain switch for effects policy: still-hold bridge strokes suspend the glowstone halo and freeze pool-light resyncs, moving strokes keep full lights. Paint sweeps accept existing same-type surfaces but track current-hold placements to prevent stacking; `tryPlace` validates each adjacent destination. Touched cells dedupe at the tick boundary; held edits use queued remesh; `flushChainBatch` batches liquid purge, portal indexing, and light recompute. The left-click TNT-target interceptor runs before chain painting; TNT otherwise remains an ordinary placeable block.
- `src/fx/tnt.js` — `TNT_TYPES` blast registry, fuses, countdown visuals, delayed chains, pooled megas, ultra band blasts, camera shake, and displaced-liquid cleanup. Chain dues use sim-time and freeze while paused. Blast deletion clears glowstone/flower/regular-TNT indexes through `clearCell`; queued pool members remain reserved until their carve and remesh finish. Mega uses shared `MEGA_PHASES` FX recipes (Firestorm Wall); each pool draws one instanced fireball shell per member crater, distributes its fixed dense-particle budget across those crater lobes by volume, and keeps one transient light. Large pools deduplicate projected x-z columns, merge each column's member-sphere y intervals on first carve (members x-sorted once per pool, binary-searched per column into scratch buffers — dense columns resolve through a difference array instead of thousands of pair allocations plus a comparator sort, sparse columns keep pair list + merge; same visited set either way) and carve the stored ranges at up to 2,048 columns/tick under an 8 ms safety budget — walking only occupied cells from the column index, in walk order (every consumer dedupes, floods, or re-sorts), so the same voxels are carved — each cell cleared through a single protected-aware write (no double lookup), with cluster-version bumps batched across the detonation instead of per cell — draining chunk buckets nearest-first in 3D from the live player position (chunk columns carry no y, so the lowest member in the footprint anchors the height and a tall pool's floor digs before its top; ignition seed when no position is known) so the crater digs near-to-far — and remesh completed chunks as the frontier passes, ahead of other pending blast chunks. At detonation an immediate jump-start synchronously completes the nearest member-home chunks outright (up to a one-second hitch) and remeshes them (prebuilt chunks are skipped by the later drain), so the nearby crater shows complete in the boom frame; the budgeted drain continues untouched behind it. Cell coordinates stay as per-cell tuples: flattening them would cross four modules for a minor gain. A big detonation also boosts the blast drains (carve 8→24 ms, remesh 6→16 ms), sustained while near (fog-visible) carve work remains so the tail keeps full budgets to the end, then drops to base for far-only tails so frames lighten. Member cells are not queued for remesh at detonation: the job's own chunkLeft/ready machinery covers those chunks in order instead of flooding the shared queue with duplicate keys. At detonation, regular TNT just outside the actual crater union is queued for a normal chain blast after 50 ms when within normal chain radius of regular TNT inside; subsequent TNT chains proceed through regular blasts. Member TNT blocks clear at ignition and queue an immediate source-chunk refresh. Finalization restores displaced liquids when applicable, purges floating liquid once, updates portal frames, and refreshes any final purge changes. Ultra reuses canonical mega phases at `ULTRA_FULL_R`, with one pause-safe FX job per phase and particles only; overworld band wipes chain TNT within the normal blast radius across altitude boundaries, allowing linked ultras to wipe adjacent bands without igniting unrelated bands. Normal chains process in bounded per-tick batches (`CHAIN_BLASTS_PER_TICK` 256): each keeps its own radius-3 crater and 50 ms neighbour delay, while presentation, purge, portal tracking, and remesh are batched. Countdown lights synchronize once per frame; pool spots come from a shared cluster cache (placement version + pool epoch + seed + kind + cap, 8 entries) used by both the lights and the detonation, so a pool's transitive closure runs once — and the lights walk a capped closure (`MEGA_SPOT_CLUSTER_MAX` 512, cosmetic only) while detonation always walks the full pool. Pools over the lights cap get their full closure precomputed during the 8 s fuse by a resumable job (`startClusterJob`/`advanceClusterJob`, member-index checkpoints in the exact sync order so the sliced run reaches the same fixpoint; members record their last scanned radius per phase (`sg`/`sl`) and radius-stable rescans are skipped — provably sterile since the candidate census is frozen and seen/counted only grow) drained at `CLUSTER_PRECOMPUTE_MS`/frame from `tickTNT` — widening to 2×/6× as the seed fuse runs out, with coarser budget checks in the last second so the tail overshoots instead of spilling sync, so the job lands before detonation; detonation reuses the hit, or finishes the live job — worst case a fresh synchronous walk, never worse than before.
- `src/fx/particles.js` — generic burst/flash effects backend (`spawnBurst`, `spawnFlash`, `tickFx`) plus batched variants (`spawnBurstBatch`: one Points cloud spread across many blast centers; `spawnFlashBatch`: one InstancedMesh with an instance per center; `spawnFireballBatch`: expanding fireball lobes in one InstancedMesh) so TNT chains and pooled blasts stay O(1) draw calls, plus the dense mega engine: preallocated GPU-seeded pools (`spawnDense`: fire 48k / ember 12k / smoke 16k plus depth-tested occluded twins (`occlude:true` default, so blasts hide behind terrain; camera-lens furnace bursts pass `occlude:false`), zero per-frame CPU integration — one `uTime` uniform per frame, batched upload at `flushDense` with partial ranges, `defer:true` layers; distributions come from precomputed unit-sphere/ball/disc tables instead of per-particle trig), shapes (ball/shell/column/ring/rain/inward), with optional crater-lobe seeding weighted by volume. Instanced voxel debris (`spawnDebris`, one burst at a time), shared flash geometry, `tickDenseFx`/`denseFxActive`/`prewarmDenseFx` helpers (pools sleep invisible at zero live particles: no dense draws in steady state). Bursts support a crater-filling spawn ball (`fillRadius`), a per-particle color `palette`, and a `foreground` mode (no depth test, drawn above everything); flashes support a constant-speed `maxRadius` fireball mode (expand then vanish in a frame — pops never retract — duration scales with radius; giant ones render double-sided and unfogged).
- `src/fx/precip.js` — falling-precipitation backend (`PRECIP_TYPES` registry, snow first; rain later is one entry): camera-following drops at a 30 Hz step, wrap + cached landing heights, material fade-in over camera altitude. Its sway clock is the sim-time passed in by `main.js`, so snow freezes mid-air while paused.
- `src/render/mesher.js` — chunked InstancedMesh renderer, streaming, local refresh, region-aware instance splitting (per-id, per-variant glowstone, flowers, liquid quads all split by `regionOf`, each group owning cloned materials and gated by its region fade; generic per-region opacity fade so anything in a region — rock, placed blocks, glowstone, liquids — reveals smoothly, with the moon's `onFade` keeping the rock opaque and tinting sky-colour→texture; combined `regionVisible && veilVisible` so a hidden region never flashes a pocket veil). Chunk keys parse negative-safe, the world clip is per-dimension (`clipBound`: bounded dims clamp, infinite dims roam). The rest-group cull box spans the rest interval (`bottom..top`, tracked in the partition pass) — a floor-based box culled everything around a below-zero eye in unbounded dimensions. Per-mesh frustum spheres (`stampStatic`) span the same true instance interval for the same reason (looking down culled whole meshes whose floor-based spheres sat behind the camera). Chunk drain borrows frame time (6→16 ms) while missing geometry sits inside the fog range, so a 2x-gravity dive holds the mesh horizon; steady movement never pays it. Mesh horizon is per-dimension (TNT 12 rings / 192 m, Nether 14 rings, overworld 8) via `renderDist()` (`registerRenderDist`). Nether chunks materialize through `ensureChunkSource` before the mesher reads them. Streaming remesh requests (`queueRefreshBlocks`) queue instead of rebuilding inline — a fall touches dozens of tall columns per tick and sync-rebuilding them all inside the tick was the frame-busting spiral; the pending set drains nearest-first under its own sub-budget (2/8 ms) ahead of the build queue. Player edits keep the sync `refreshBlocks` path — which rebuilds built chunks, leaves queued ones to the drain, and queues unbuilt ones for the budgeted build instead of dropping them, so long-range placements past the stream window still materialize. Every rebuild/dispose bumps a per-chunk version (`chunkVersion`) so the optimistic chain proxy (`chainproxy.js`) knows when its transient cells are covered by the real mesh. Blast isolation stays generation-only and never restricts player placement. Streaming builds fade in (`rebuildChunk(..., fade=true)` from queue/clear-bubble only — the spawn `rebuildAll` stands atomic so the entry frame is complete, never edits or band remesh): transient cloned materials ramped over `FADE_T = 0.35` s then restored/disposed, snapped shut past fog far, purged on dispose; `nearestMissingDist` reports the closest queued chunk so fog caps on missing geometry.
- `src/ui/menu.js` — Play/Resume/New-World overlay, pointer-lock wiring (no saves). Play is clickable from the first frame; entry waits for the first rendered world frame (`pendingPlay` in `main.js`: click arms entry plus a best-effort lock, pre-start lock never hides the menu); New World locks on click then rebuilds under closed-in fog (guarded against double builds); Esc unlock shows Resume + New World. Boot builds in slices behind the menu; no spinner anywhere.
- `src/ui/debug.js` — `=` HUD readout (`fps N | x X  y Y  z Z`: FPS exponential moving average, quarter-second refresh, hidden until started; integer block coords are the floored feet position passed in from `main.js`).
- `src/ui/help.js` — help overlay open/close. Shortcut table: Move, Jump, Sprint, Place, Break, Select, Fly, Grapple, Help, Debug (Z cheat-gated dimension cycle and V cheat-gated speed cycle stay unlisted). Help style stays terse: one verb per control row, no mode details in the panel (paint/stairs, dig/tunnel, homing TNT live in their Broad-logic sections). Portal frame diagrams are painted by `portals.js` (`buildPortalDom` at boot).
- `tests/headless/mobs/corridor.test.mjs` — pure corridor-policy tests (helpers, classifier, junction choice distribution, lane walkthroughs, lock-cell dead-end U-turn, straight-cruise entry healing), three-free, `node` direct.
- `tests/headless/mobs/mob-paths.test.mjs` — kinematic rigs (1-wide: straight/L/T/cross/zigzag/dead-end/turn-stub/door-niche in and back out with arm-centre asserts; spiral with 4 chained turns into a central dead end, in and back out; pit-across rigs (drop-1 trap, drop-2 mirage with a parallel corridor) asserting lip U-turn, no descent, no doomed funnel, and walk-back; 2-wide: straight/L/funnels/mixed-T with wall-offset asserts and no middle-glide; doorway; field mouth; open-field straight (no turn without obstacle); walled-room coverage (body within 0.5 m of the walls); stride validation units; fence-hole ring both ways; live-village house-door trials both ways) driving the real mover on live voxels, paired muret-vs-trench with bit-identical traces proving air walls ≡ solid walls, `node` direct.
- `tests/headless/mobs/village-doors.test.mjs` — doorway passability on adversarial sloped terrain: every house sill, apron, and interior floor leveled to the village height with 3-high headroom, wall rings intact, pen ring intact, `node` direct.
- `tests/headless/mobs/separation.test.mjs` — mob-vs-mob cooperation on live voxels through the real tick: head-on/crossing/overtake arrival with contact budgets, pen-density soak (deterministic, backstop clears everything), offset head-on crossing rig at the shipped budget (determinism, line-hold, safety bounds), group converge + triangle deadlock, pen-spread herd coverage per unification mode (≥ 20% of mob-ticks near the fence — a far wall vetoing evasions pins the group at the center), nose-parity per mode (≤ 300 snout-contact ticks — both modes warn before contact), dense-turns frankness per seed (no full pirouette inside one lane-less commit, planted-rotation volume, straight-cruise bend, flip bounds — servo ticks excluded by design), grid-vs-full-scan bit-identity, `node` direct.
- `tests/browser/mobs/hook.js` + `tests/browser/mobs/mob-paths.mjs` — `?test=1` in-page hook (deterministic rig build + sim stepping through the real game tick, inert unless set) plus its puppeteer driver (dev-only peer dep, never shipped) mirroring the headless predicates.

## Tests

- Headless suites run under plain `node`, three-free, no browser: `node tests/headless/mobs/*.test.mjs`. They must stay fast and instant (seconds for the full set) — that speed is what makes them runnable as non-regression after every change. `mobs/` holds the first suite; new domains get their own folder beside it.
- Every behavior change under `src/` ships with its rigs in the same commit: extend the suite covering the touched module (corridor policy → `corridor.test.mjs`, servo kinematics → `mob-paths.test.mjs`, village doors → `village-doors.test.mjs`, mob-vs-mob → `separation.test.mjs`), and update the Tree bullets above in the same commit.
- Browser instrumentation (`tests/browser/mobs/*` via `?test=1`, puppeteer driver) runs only on explicit user request; cases it reveals that the headless suites do not cover come back as new headless rigs.

## Data model

- Block ids are stable integers (`AIR = 0` … `MOON_WATER = 21`); new blocks only append.
- `BLOCK_INFO[id]` carries `solid`, `opaque`, `placeable`, and the `light` emitter key for emissive blocks (glowstone first). Physics and meshing both derive from it; block lights dispatch through it. `opaque` means fully occluding for meshing culls (PORTAL included — its texture is solid, so water sheets and neighbor faces cull against it instead of z-fighting at the contact).
- Voxel key: `(x + 65536) * 2^34 + (y + 65536) * 2^17 + (z + 65536)` (decoded by `keyXYZ`, kept beside the encoder; ±65535 every axis, exact under 2^53); one `Map` per dimension in `worlds`, built from `DIMENSION_KEYS` so new dimensions add storage without a fork. `outOfWorld`/`dimBound` gate raycasts, floods, and clamps per dimension (bounded dims: the old cube + y >= 0).
- No ceiling: columns run any `y >= 0`; `dim`/`world` point at the active dimension's map and tops. The unbreakable floor is per-dimension data (`floorY`: `0` everywhere except the floorless TNT sky (`null`) — no catcher, falling below `-20` respawns in the active dim). Worldgen bottoms out at it: overworld columns, Nether terrain and volcano cores, and the one-block End platform (which is the floor).
- Noise (`noise.js`) matches master's formulas exactly, including its z-flipped
  bilinear blend — required for a sane land/water ratio, do not "fix".
- Sparse column tops (`Map`, missing reads 0; `topAt`/`bareTopAt` readers) track the highest non-air block per column for meshing and spawn; `colOcc[dim]` (`colIdx` → `Set` of occupied y) lets meshing iterate blocks instead of scanning height, and `colLiqTop[dim]` (`colIdx` → highest liquid y) answers swim queries in O(1) — all maintained by `setBlock`, plus the bulk `fillColumn` fast path used only by initial terrain fill (identical voxels and indexes, one bookkeeping pass per run).
- Village state is a single `village` object: center, bounds, houses, pen, pool, radius/houseCount tunables.
- Player state is module-level: `pos`/`vel` vectors, `yaw`/`pitch`, `onGround`,
  step-up/step-down flags, jump buffer/rebound trackers, shared `keys` map. `flyOn` is dimension-independent and survives every portal traversal (all portals sever only the hook and zero velocity).
- TNT state: player-placed normal TNT coordinates are indexed per dimension
  for mega-crater edge queries (purged per dimension on regenerate-dimension entry, kept across trips in retain dimensions); lit fuses live in a `lit` map (`"x,y,z"` → fuse),
  chained blasts wait in a `pendingChain` map (`"x,y,z"` → due time); liquid displaced by placed TNT
  waits in a `displaced` map (`"x,y,z"` → liquid id, restored in that cell
  after its blast unless the kind clears liquids, cleared on world build); placed mega blocks are indexed in
  `megaIndex` for instant pool clustering (added on place, removed as blasts
  consume them, cleared on world build and on every dimension switch (fuses do not cross dimensions — `lit` and its sprites are snuffed on every travel, so no fuse ticks foreign voxels); the blast refresh callback and the
  post-blast floating-liquid purge (`onLiquidPurge`) are injected by the caller.
- TNT tier progression lives in `tntunlock.js`: one cumulative dragon-kill counter for the world (reset by New World; the End's own per-entry boss reset never touches it), thresholds `MEGA_TNT` 2 / `ULTRA_TNT` 3, plus a boot-time `?cheat=1` bypass. The bar and placement read it; the TNT dimension ignores it.
- Glowstone color lives in per-dimension variant maps (`"x,y,z"` key → variant index, default green) plus a live block index per dimension (clustering reads the stones, light buckets read the index — no world scans); placed stones inherit the nearest variant within 10 blocks, cleared on break/blast/world build and per dimension on regenerate-dimension entry (retain dimensions keep theirs across trips — no ghost lights in fresh worlds).
- Flower looks live in per-dimension maps (`key(x,y,z)` → variant index + Y angle): every placement (worldgen scatter, player place) draws a fresh weighted-random variant and angle via `noteFlowerPlace`; the mesher only reads them back, so rebuilds never reshuffle a look; cleared on break/blast/world build and per dimension on regenerate-dimension entry.
- Farm mobs are per-dimension entities (`type` pig/cow, `dim`, feet `pos`, `hw` 0.32 both, `h` 1.02/1.30, corridor state (`lane`, blend, stall guard, commit `{heading, target, span, runT}`, follow line + session/cooldown, funnel timers, `jrng` junction stream, `redecide` flag), cooperation state (`_peerIdx` tick index, `_plan` one-tick group override + `_planHold` latch, `_detour`/`_wiggles` stuck maneuvers), seeded pen layout via `setFarmSeed`): 4 pigs + 4 cows spawn strictly inside the pen (never fence ring, trough water, or rim); retain dims keep theirs across portal trips (hidden while away), regenerate dims wipe that dim's mobs on entry — all driven by the destination spec's `persistence`, never a dimension fork.
- Render state: `chunkMeshes` (`"cx_cz"` → per-id InstancedMesh), a build queue,
  shared materials cache. Scene, camera, and renderer are owned by `main.js`.

## Data flow (generation)

`generateOverworld(seed)` runs one pipeline: seed → river paths → village layout
→ per-column terrain fill (flattened to stone inside village bounds, water below
`WATER_LEVEL`) → trees/flowers (flowers only on grass with air above, presence
hash-gated by `TERRAIN.flowerDensity`, each placed flower drawing a fresh seeded variant + angle via `noteFlowerPlace`) → `placeVillage` structures. `generateClouds` scatters solid puff
clusters in the `CLOUD_MIN_Y`…`CLOUD_MAX_Y` band afterwards, then `generateMoonSurface` lays the rock cap
with hashed `MOON_WATER` lake shafts at `MOON_SURFACE_Y` (tops final before spawn). Spawn selection (`findSpawn`) closes the pipeline:
nearest firm open ground to the origin whose vista stays clear 50 blocks ahead
across the whole FOV swath and 12 rows above the eye — no wall, trunk, hillside,
or canopy anywhere in the frame. Pen cells excluded, liquids never qualify,
cloud decks and moon rock never qualify for footing (the scan starts below the moon band, so it stays fast).
The legacy TNT pipeline (bounded cube, still the headless reference) is separate: two-phase greedy scatter (`pickCenters` → `scatterTier`: megas placed sparsely first, then regulars accepted wherever their edge gap to every accepted cloud clears that pair's blast need plus its tier-split margin (flat 1% mega-involved, 5–20% normal–normal), using per-cloud bounding radii) → one-tier compact puff clouds (`TNT`/`MEGA_TNT`) → post-fill voxel sweep that throws on any core-rule violation → `tntdim.js findTntSpawn`; regenerates from a fresh seed on every entry (retained dims skip this). The hollow underside shell fills after the reveal, not in the pipeline: `main.js` slices `generateMoonUnderRows` across idle frames (same geometry/salts as the eager port), then remeshes built disc chunks via `refreshBlocks` (`moonChunkCenters`; chunks streaming in later already contain the voxels). Below the moon band the fill finishes synchronously instead, so descending never meets an unbuilt shell.

The Nether is stream-generated: `setupNether(seed)` (rivers → corner volcanoes → cascade bands + ban mask → return platform → bridges sited on landing shelves or natural island relief → high fans) runs once, then `generateNetherChunk(cx, cz)` materializes one render chunk per mesher read: fbm seabed plus lava sea/soul shores, rugged fbm islands with lava rivers and cliff streaks, a 5x5-neighbour cone shell (`SHELL_DEPTH` 3, hollow and fully closed) plus the central `baseY..rim` lava shaft and its flush crown, constant-section cascades draping down the cone and over island relief into the sea, then each tunnel as a hermetic tube (carved 8-wide walk box → 1-block lining plus a buried-only second layer, glowstone ring sized on the carved mouth in one deterministic hue per mouth → open view corridor), followed by the enforcement pass (re-clear bores/corridors, re-seal shells/collars/doorsteps, re-place rings last); the only openings are the frame doorway and the lava face. `generateNetherDimension` is the full reference and `prepareNetherDimensionAsync` the boot path (setup + return-platform chunks only) so `?startdim=nether` reveals instantly while the fog (`fullView`, no unload-horizon cap) and chunk streaming cover the rest; a direct Nether boot then applies the portal arrival around the return frame instead of leaving the player on the raw spawn pad. The Nether retains its voxels between trips and resets only on New World; streamed glowstone registers into the live index, so built chunks pick up the baked halo.

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
synchronously, so nothing ever pops in. Empty chunks are tracked as built too,
so deferred edits and held bridges can remesh them instead of losing updates.
Eviction waits for both the loose ring and the fogged range: a chunk outside
`RENDER_DIST + UNLOAD_MARGIN` disposes only once its slab also clears fog
far plus margin, and anything still queued inside the clear bubble builds
synchronously before the frame renders.

## Data flow (runtime)

`main.js` loop: always render + camera follow. Boot loads a world in slices
behind the translucent menu: voxels generate 12 rows per frame, the spawn
neighborhood (radius 2) builds, then movement unlocks at once while
closed-in fog (8–20) opens to its tuned range on a pure wall-clock
reveal (`tickReveal`, loader-exempt, monotonic — never stalls or recedes)
and far chunks keep streaming in behind
it — the reveal stays pure fog motion over existing geometry, never ghost
clarify, and the clear-bubble guard meshes anything entering visibility
synchronously.
A tightening-only
runtime fog guard caps fog far by
the 3D distance to the nearest evictable slab (minus margin), by the nearest
still-missing chunk (streaming always debuts fully fogged), and shrinks
the clear bubble with speed, so loading and unloading stay hidden at any
altitude or pace; the dive-murk baseline tracks the guard. Chunks that still
materialize inside the visible range
fade in over 0.35 s instead of popping. Single writer: only the fog
controller (reveal, then streaming guard) writes `scene.fog` near/far;
`envAir` mirrors the eased scene values and the murk never copies it back,
so the `k=0.12` easing always applies. The loop
ticks the high-altitude sky first (`sky.js`: per-dimension base colour from `DIMENSIONS` env — red in TNT — black past the clouds with stars only where the env keeps space (overworld),
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
builds (`refreshBlocks` rebuilds built chunks, skips queued ones for the drain, and queues unbuilt ones for the budgeted build). Pause (`simActive`: locked and help closed) gates every sim and visual tick — player/hook/TNT/portals, particles, snow, block lights, fog, sky, regions, murk, shake — while the loader, the debug readout, and the final render keep running (see Pause contract). While active: movement (hook, else fly, else walk) → TNT tick → portal tick → raycast target + highlight → stream nearby chunks + voxel lattice (`tickTntStream`, loader-exempt, beside `maybeStream`). Falling below `y = -20` (overworld; the TNT sky has no floor)
respawns in the active dimension (the portal last left there when it validates, else that dim's spawn). Portal windows refresh around the player (fills always exist but
fog like anything else); while the active dimension's `exitsGate` is closed no portal fills or travels — touching any validated window answers the dimension's gate toast once per entry (see portals); stepping into a fill plays the spiral; every window switches worlds (there is
no same-dimension loop) and arrives through the destination's `arrival` policy
(see portals) with a 1.5 s cooldown; the transition loads the destination behind the spiral (voxels, then full-ring budgeted meshes capped ~1.5 s) and the spiral lifts only once the arrival is meshed, fog already at its final range. The lift plays a fixed jump burst (spiral stretch + flash, spiral color by destination — overworld green, Nether dark blue, End violet, TNT dark red; families declare their color on the spec, the familyless Overworld green lives beside the resolver) with an FOV punch that eases back on sim-time. A single spiral visual covers the screen (front 6-arm and back 4-arm counter-rotating ribbon swirls, each cone-projected so the arms funnel into the vanishing point like entering a cone — deep front cone, shallower back cone for parallax — sharing the burst and the destination color), turned by a rAF loop (immediate x0.5->x6 ramp from the first frame; transform-only writes on two nodes, angles persist across travels). Temporary debug key (Z) cycles Overworld/End/Nether/TNT without a portal through the same transition, but bypasses the exits gate and records no return link. Play is clickable from the first frame but entry waits for the first rendered world frame; Esc
shows Resume + New World (fresh seed, same sliced-load flow; New World locks
first, then rebuilds under closed-in fog). There is no
persistence.

## Pause contract

- Paused = pointer unlocked (menu) or help open. `main.js` computes one `simActive` (`worldReady && started && !building && isLocked() && !isHelpOpen()`) and every sim or visual tick runs only behind it: player/hook/knockback, `tickTNT`, `tickPortals`, `tickFx`, precip, block lights, hook visuals, streaming fog, sky, regions, dive murk, camera shake, highlight. Pausing freezes the frame; unpausing resumes it — nothing fires, decays, or catches up in between.
- Time-based logic takes `dt` plus sim-time only — never `performance.now`/`Date.now`/`setTimeout`/`setInterval` in a tick path. Pending futures are state + `dt` countdowns decremented in their tick: TNT chains (`pendingChain.due` off `simNow`), precip sway (sim-time passed in by `main.js`). Portal travel is loader-driven behind the spiral (`runTravel` rAF slices + minimum spiral time), never a sim-time pending, so pausing mid-transition never stalls the load.
- World speed (`V`, cheat only, ×1/×2/×4/×8/×16 wrapping) is one `sdt = dt * gameSpeed` handed to world ticks (mobs, TNT, portals, particles, precip, lights, sky/ambient, blast clocks) and added to `simTime`; player movement, camera/shake decay, chain editing, and loader/visual transitions stay on real `dt`.
- Loader and UI-only code are the only wall-clock exemptions, named here so future agents don't "fix" them: chunk/voxel streaming (mesher budget + `tickTntStream` gen/evict + travel preload/finish slices, loading, not sim) + background moon fill (loading, not sim), fog reveal (`tickReveal`, loading, not sim) + chunk/fill fade ticks (`tickChunkFades`/`tickPortalFillFades`, loading, not sim), `tickDebug` FPS readout, hotbar wheel throttle, hotbar unlock pop (CSS, one-shot), `helpJustClosed` grace, toast/spiral DOM fades.
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
  thrust with ramp and boost, jump buffer, air steering; no-input air after a
  grapple fling bleeds horizontal linearly (`FLING_LIN`) from release on, so
  the trajectory is a parabola with a vertical asymptote end to end (snap
  below `FLING_SNAP`). One-block steps climb
  automatically via `tryStep` (glide to `stepUpClearY`); walking off edges sets
  `stepDown` for smooth descent.
- Water: swim toward surface-drift speed with deep accel and near-surface brake;
  jumping toward water while holding jump rebounds ballistically to the jump's
  start height. No jump streak speed boost.
- Fly (`KeyF`): pitch-aware thrust through the shared axis movers
  (`collideBody` with ground bookkeeping off plus a 1-block instant fly-step
  gated per blocking cell by the fly-step allowlist — `main.js` wires it to
  live portal sills only, so plain ledges still stall flight), no gravity
  or swimming.
- Hook framework (`hook.js`): pick → filter → fly → pull → arrive/release →
  retract. `fireHookTarget` dispatches through the spec — no kind-name
  switches: the filter table resolves target kinds to anchors, and the
  active `HOOK_TYPES` entry supplies speeds, pull mode, ghost, and retarget.
  Each target also carries an `alive` liveness check (anchor cell still
  solid, fill window still live): a dead anchor retracts the hook at the
  next frame — mid-flight, mid-pull, or settled — instead of completing to
  thin air.
  A mob grab adds a filter entry (`{ kind: "mob", ref }` from a mob picker)
  plus a kind entry with `pull: "anchor-to-self"` and a following `retarget`
  (anchor tracks `mob.pos` + offset every frame, flight included); release
  and sever paths are shared, with no physics changes. Grapple (middle-click or G, release to let go): any solid block (ground, wall, ceiling —
  never liquid) plus any live portal fill, unbounded DDA pick (`Infinity`, 1024 steps, like edit picks) composed with the fill-slab ray (`grapplePick`: nearer hit wins), eye anchor `0.3`; refused while flying, hooked, or in fly
  mode. Head flies parametric (`fly 0→1` at `throw × boost`) onto the aimed
  face plane (`headOff` 0: cube centered on the surface, half-buried), physics live underneath so falls continue. The
  pull owns the frame (dispatched through `spec.pull`: velocity toward the
  landing, substepped collision +
  slide), ghosts the anchor column only for top landings (`topLand`: stack
  rides up to stand on top; taller faces land in the free cell before the
  hit); stalls stop in place after 3 stuck frames. A pull that starts in water
  never carries the player out of it (block anchors only — portal fills still
  pull in to fire travel): reaching the water edge, or a dry landing, settles
  in place with the rope pinned instead of climbing onto a surface block and
  freezing there. Arrivals stop dead and
  pin the rope: a settled hook hands movement back to physics only while the
  body is in liquid, whatever the anchor face (ground, wall, ceiling) and
  wherever the shot came from. While the body is submerged, it swims:
  look-relative 3D thrust (W/S along the pitch, A/D strafe, swim speed,
  sprint); a dry eye sinks back under the surface, and each axis move passes
  only if the eye ends wet or does not rise — the camera fills the top cell
  up to the surface at most, and jump never exits it. The top submerged cell
  adds a gentle idle rise; deeper cells swim neutrally, so deliberate diving
  still reaches them. Open-air settles freeze in place, jump inert, until
  mouse-up plain-drops.
  Face arrivals back off the aimed face
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
   or solid); break and grapple always skip liquids. Holding a button chains:
   moving the mouse paints/breaks continuous surface-hugging strokes (sampled
    prev→live rays, anchor-range gated, sky pauses and resumes); holding still
    1.0 s digs repeatedly (10→60/s) or builds bridge stairs toward the feet
    (plateaus, steep-slope spirals, feet-cell arrival), resuming where the
    stroke stopped while held (`chain.js tickChain`, one batched refresh per
    frame, sim-time, every placeable block stairs including mega/ultra). The bridge latch tolerates micro-travel below `bridgeStillPx` (15px summed raw, mirror of the dig `movePx` gate); deliberate travel paints instead. While
    the bridge latch holds, the glowstone halo bake is suspended and pool-light
    resyncs pause (geometry-only rebuilds); moving strokes keep full lights,
    and the bridge tint bakes on release through the budgeted drain. First break-click on TNT lights its fuse with no remesh (block kept); a second break-click on lit TNT detonates it at once.
  Live edits purge floating liquid: any
  same-liquid group left without a solid 6-neighbor returns to air. The floor
  (`y = 0`) and liquids are unbreakable; solid placement refuses the player's
  own AABB.
- TNT: first break-click on a TNT block lights its fuse with no remesh (block kept); normal shows a steady depth-tested white countdown sprite (orange-red under 1 s, relief occludes it), mega (blue block, id 22) an 8 s fuse with an accelerating blue-to-white veil pulse plus white heat and pooled lights, no number. A second break-click detonates lit TNT at once, notifying the portal index itself since no refresh callback is in play. Normal blasts clear a sphere (radius 3, open ball with the corner shell trimmed so the small crater reads round at the same reach) and chain neighbours with 50 ms delays; same-tick chained blasts batch their presentation (one shared flash + particle cloud, one purge, one portal pass, budgeted remesh — `CHAIN_BLASTS_PER_TICK`), so hardcore chains stay O(1) draw calls and never rebuild chunks synchronously. Megas link transitively at blast distance into one simultaneous pooled blast: upfront neighbor search over the live `megaIndex` (candidate census parsed once, scanned through a spatial hash sized to the 40 cap, so a big pool never re-parses or re-scans the whole index per growth iteration; the "inside the pool" test is local too), +50% compound radius growth per neighbour within the member's current R/2 (cap 40, Ø80 ~= village diagonal), one crater and one instanced expanding fireball shell per member at its own radius with volume-weighted dense particles (Firestorm Wall; all lobes bloom together while large pools slice their carve across frames), carve clamped to column tops. Normals caught in a pool go off instantly instead of cascading; a mega uncovered by a normal blast joins the pool. Ultras (black block, id 23) reuse the mega bucket countdown tinted black and wipe per the dimension's ultra mode — one altitude band of the whole level in the overworld (ground (1–90), cloud (91–`CLOUD_MAX_Y` + 1), moon (above, to the column top) by ignition height), an ignition-centered window elsewhere (256-disc, ±256 full column in the Nether and the TNT sky so volcano tops and everything above the ignition go too, ±90 in the End) — carved as a radially-sorted column job under a fixed per-tick budget; carving only mutates voxels and records dirty chunks, while `drainBlastRemesh` remeshes under a 6 ms budget nearest-first, gated on the carve frontier (a chunk rebuilds once its last touching column is carved, never twice; unbuilt chunks drop out for streaming), so even the ground band never freezes a frame. Portal frames track cheaply with fills healing from the dirty flag, floating liquids purge once at job end, and the spectacle is one persistent additive shell repositioned in place from the front radius (single draw call, no per-frame allocation) over a modest ignition flash; the renderer also dips to DPR 1 while a band carves. Fills hide at ignition and one full `scanWorldPortals` resync at job end removes every destroyed window's fill at any distance. Same-band lit fuses and queued blasts die with the band in bands mode while cross-band lit ultras keep burning (in window mode everything inside the window dies), and any carve uncovering an ultra queues its own band blast (ultras never pool). Each blast clears solid cells except the floor level (`y = 0`); liquids survive (blast passes through) unless the kind sets `clearsLiquids` — mega and ultra clear them and, placed in liquid, leave air behind instead of restoring it,  while normal TNT restores the displaced liquid afterwards and placed in air leaves air behind.
  After every blast, liquid groups left with no solid neighbor are purged back to air. Player launch is one centroid shove per pooled blast (uniform 1.5R travel: ballistic arc on ground, decaying `knockVel` impulse along the mega→player line in fly, fly mode kept), plus camera shake out to 3R (max inside, linear to 2R, exponential to silence, via per-kind `shake` spec).
- Hotbar: dynamic list (add/remove/change/reset, selection by id) over 15 base overworld items (`GRASS` … `OBSIDIAN`, mega and ultra TNT listed after normal TNT once unlocked — the TNT dimension always shows all three), texture-icon
  slots; wheel, `K`/`L`, and click all select with wraparound. The single tier a dragon kill unlocks plays master's one-shot `unlock-pop` (nothing else animates). In moon dimensions, eight below the Moon's lower end the water slot becomes moon water and the flower slot becomes glowstone, restored on descent.

## Tuning (world specs, not constants)

- `TERRAIN`: land raise 20, basin (shore 1.5, depth 2.2), rivers (3 paths,
  step 36, width 6, bed 8), flower density 0.015. `WORLD_RADIUS = 96` and
  `WATER_LEVEL = 10` stay global.
- `VILLAGE_SPEC`: radius 28, 8 houses, pen 15×13, pool 8×6×2, pen pool
  2×2×1 (see `configureVillage` to grow).
- Spawn: feet inside radius 48, vista 50 ahead / 12 up across the FOV swath
  (`VIEW_HALF_TAN` from the 75° FOV), pen margin 1.
- Moon: bottom `MOON_MIN_Y` = 850 (hand-picked), surface `MOON_SURFACE_Y` = 946, radius 96, shell 5, 6 hashed lakes; surface (cap + lakes) builds with the world, hollow underside fills lazily in 16-row slices after the reveal plus chunk refresh, sync below `MOON_MIN_Y` - 8; low gravity from 850, toolbar flips 8 below at 842 (water→moon-water, flower→glowstone), sky black 475→495 (all `moon`-gated, overworld only), the Moon reveal region fades 495→515 (disc, lakes, *and* every block placed at `y >= MOON_MIN_Y` — stones, dirt, flowers, liquids — fading together so blue sky never shows a moon-side silhouette or a popping glowstone), snow fades in over its gate span (also `moon`-gated).
- Glowstone: 7 color variants, cluster inherit within 10 blocks else fresh random; unlit per-variant textures; pooled point lights (one entry per block, bounded nearest-16 in one pass, no distance cutoff, decay 2, intensity 150, 8/s position+color glide with snap at rest, 0.5 s sticky reassignment) that read on lit blocks (moon rock is Lambert + emissiveMap base ~0.85 so the underside stays readable; moon-water sheets stay unlit).
- Snow: 700 flakes, range 36, size 0.18, fall 2.5–5.5, 30 Hz step with landing heights refreshed every 8th step, hidden below its gate span, active above `MOON_SURFACE_Y - 8` in moon dimensions (`dimHasMoon`).

## Tuning constants (player)

- `WALK = 4.4`, `SPRINT = 7.2`, `GRAVITY = 37.44`, `JUMP_MIN = 8.2`, `FLY = 10` (3x with sprint), held-grapple swim 4.2 (sprint 7.2, idle surface-cell rise 1.5, dry-eye sink 1.5).
- Hook kinds: `HOOK_TYPES` (grapple: pull 26, fling 34, throw 70, retract 275, uniform boost 2, retract mini 0.08 s, eye 0.3, head 0, face gap 0.15, hang clear 0.6); new kinds register a spec.
- `JUMP_HOLD_TIME = 0.7`, `JUMP_THRUST = 45`, `JUMP_RAMP = 0.25`, `JUMP_BUFFER = 0.2`.
- Blast kinds: `TNT_TYPES` (normal: fuse 3.0, radius 3, `blastKind:"sphere"`, `countdownKind:"sprite"`, `fxKind:"burst"`, `chainDelay` 0.05, per-tick chain batch cap `CHAIN_BLASTS_PER_TICK` 256; mega: fuse 8.0, radius 15/22.5/33.75 capped at 40 (`megaPoolRadius`: link at current R, growth per neighbours within current R/2, both transitively over a live mega index; carve clamped to column tops), `blastKind:"pooled"` (transitive simultaneous pool, one crater and one expanding fireball shell per member at its own radius, drawn together in one InstancedMesh), `countdownKind:"bucket"` (veil + white heat + pooled lights swelling 12→own crater radius with the white heat, one physical-falloff light per pool member (cutoff 1.6R: bright edge on the crater rim, soft halo just outside) — whole-level range for ultra bands — + one telegraph shell per lit mega that grows 0.3→1.2 blocks over the last 3 s of fuse, no number; veil tint follows the mega kind), `fxKind:"mega"` via `spawnBlastFx` dispatching through `MEGA_PHASES` (wall; counts scale with R^3 via `denseCount`, capped by the GPU pools; dense particles distribute across crater lobes by volume), `knockback` (launch + shake out to 3R via per-kind `shake` spec, max inside, linear to 2R, exponential to 3R; ballistic arc on ground, decaying `knockVel` impulse along the mega→player line in fly) + one transient blast light + sim-time flash/veil overlays + DPR dip while `denseFxActive()`/`megaFxActive()`/`megaCarveActive()` (dip also anticipates via `megaImminent()` in the last 0.6 s of fuse), id 22; ultra: fuse 8.0, radius `ULTRA_FULL_R` (bands mode — covers the level from any ignition; windowed dims use their `windowR`), `blastKind:"band"` (one altitude band in the overworld — ground 1–90, cloud 91–`CLOUD_MAX_Y` + 1, moon above to the column top, plus the band-1 tree-overhang flood — carved as a radially-sorted column job; dirty chunks remesh in `drainBlastRemesh` under a 6 ms budget nearest-first, gated on the carve frontier), `countdownKind:"bucket"` tinted black via `countdownColor`, sharing the mega strobe/countdown-light pipeline, `fxKind:"ultra"` (`ULTRA_PHASES`: tornado, fat shock rings, wall, trimmed smoke chained at `ULTRA_FULL_R` via sim-time `fxJobs` dues; the band carve underneath is unchanged; fullscreen overlays reuse a fixed overlay under the same LoS rule), shake-only (`shake` max 1.5 at full reach, sustained via `bandFront()` while the camera sits inside the front), id 23); post-detonation mega/ultra timelines run through `MEGA_BLAST_TIME_SCALE` (= 1; `MEGA_BLAST_T` = 2.2 s), while fuses stay 8 s; new tiers register a spec.

## Tuning constants (render)

- `CHUNK = 16`, `RENDER_DIST = 8`, chunk build budget 6 ms/frame, spawn sync radius 2. Unload lags
  load by three rings (`UNLOAD_MARGIN = 3`, free: the rings clip to the
  finite world) and past the fogged range
  (`DISPOSE_MARGIN = 10` beyond fog far, 3D slab distance), so border
  crossings never pop; anything queued inside the clear bubble builds
  synchronously before the frame renders.
- Fog 60–160, sky `#87ceeb`, sun + hemisphere lighting. Fog far stays inside
  the nearest evictable slab distance at any altitude (tightening-only guard
  caps it by the 3D unload distance minus margin, clear bubble shrinks 20%
  at full sprint speed), so loading chunks debut fully fogged and evicted
chunks are fully fogged first. Voxels generate in 12-row slices, the spawn
neighborhood builds at radius 2, then closed-in fog (8–20) opens over
`REVEAL_MS = 1200` without gating movement — one lerped writer
(`updateStreamingFog` from the first frame, target also capped by the
slow-start reveal curve) so the fog never snaps or recedes, however slow
the loader is.
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

Seed rule (fundamental): every added feature must be controllable with the
`?seed=` world seed wherever possible. Worldgen and gameplay draws go
through `hash2`/`fbm(seed + salt)` or a seeded setter (`setFlowerSeed`,
`setGlowSeed`, `setMobSeed`, `setTntStreamSeed`); `main.js` pins one session
seed from `?seed=` (`rollSeed`) and reuses it for every generation while it
is present, rolling fresh otherwise. `Math.random`/`Date.now` in a tick or
generation path are forbidden except for the documented cosmetic exemptions:
particle bursts, precip drops, sky stars, canvas textures, help-diagram
shuffles, and per-frame death-shake jitter — ephemeral, never persisted.

Every variant family follows the same shape — new variants are registry
entries, never framework forks:

- One exported registry array of spec objects, each with a `key`
   (`TREE_TYPES`, `FLOWER_VARIANTS`, `GLOW_VARIANTS`, `TNT_TYPES`, `HOOK_TYPES`, `PRECIP_TYPES`, `HALO_SOURCES`, `REGIONS`, `DIMENSIONS`, `MOB_TYPES`, `LIVESTOCK_SPECS`).
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
- Generic `spawnBurst` supports directional cones with `direction` and `spread`; dragon breath uses this emitter for its three-second particle jets.
- Every tick-shaped hook (`tickLitVisual`, `spawnBlastFx`, precip `active`/`landed`, `REGIONS` factor) obeys the Pause contract above: `dt` + sim-time in, no wall-clock out.
- Per-dimension properties follow the same shape at the dimension level:
  `DIMENSIONS` specs carry gameplay props (`moon`, `ultra`, `skyGrapple`,
  `infinite`, ...) read through `dim*` accessors, and render props ride the
  per-dim `env` (`sky`, `fog`, `sun`, `space`, ...). Framework code never
  branches on dimension keys — a new behavior asks "does this belong to a
  dimension?" and ships as a spec field or env key; a new dimension walks the
  checklist (env, moon?, ultra mode, hotbar, spawn, arrival, frameKeys, persistence, ambient,   fullView, renderDist, respawnY (null = no floor),
  floorY (`0`, `null` = floorless), region `dim` tags, precip `active`s, gravity zones).
- Cosmetic variants follow the recipe: weighted options table → stored per-block look drawn at placement (`flowerVariantAt`/`flowerAngleAt` reads, `noteFlowerPlace` draws; `glowVariantAt`, clustered on place) → baked geometries/materials + shared material.

Single-anatomy numbers stay plain constants: world dimensions, body
physics, render budgets. Single-spec systems (`TERRAIN`, `VILLAGE_SPEC`) become registries only when a second variant arrives.

Shipped: trees (oak; pines later), flowers (7 variants), glowstone (7 color variants, clustered placement, baked halo via `HALO_SOURCES`, selective pool: one lamp per glowstone cluster fitting in 5×5×5 plus grid crossings on chains + one light per Nether portal and tunnel ring via `poollights.js`), TNT (normal,
`blastKind:"sphere"`, `countdownKind:"sprite"`, `fxKind:"burst"`; mega,
`blastKind:"pooled"`, `countdownKind:"bucket"`, `fxKind:"mega"`, id 22; ultra,
`blastKind:"band"`, black bucket countdown, `fxKind:"ultra"`, id 23; mega unlocks at 2 dragon kills, ultra at 3 — the TNT dimension exempt, `?cheat=1` bypass), hooks (grapple, `pull:"self-to-anchor"`;
grab later), liquids (water + moon-water + blue-lava outside/pocket roles),
precip (snow; rain later), portals (`PORTAL_TYPES`: end frame `PORTAL`,
nether frame `OBSIDIAN`, tnt frame `TNT`/`MEGA_TNT`/`ULTRA_TNT` (frame is one
id or a set of ids), per-spec sizes, fill, destination, travel action, help
art; End/Nether/TNT cross dimensions and return to the Overworld when used in
their own. Overworld arrivals face the portal; every other dimension arrives
with its back to it. Arrivals use the portal last left in the destination,
else the dim spawn). Ambient FX ride
a parallel registry (`AMBIENT`, Nether first).
Shipped: mobs use the stable-key `MOB_TYPES` registry (locomotion capabilities `walk`/`jump`/`float`/`swim`/`fly` — `float` buoys 2/3 of the body out of the water (`MOB_FLOAT_FRAC` 1/3), `swim` is directed underwater locomotion — plus homing-TNT flags, create/tick/damage/dispose hooks). Flying mobs default to homing TNT and a three-shot volley limit; a mob spec can override the cap. The dragon and Enderman are End-specific mob specializations (spawn spots, phases, spit timers seeded via `setMobSeed`); pigs and cows are walk+float farm specializations from the generic quadruped plan (master-true visuals, 4+4 seeded pen spawns via `setFarmSeed`, basic wander with breach exit). Overworld and Nether retain voxels; End and TNT regenerate per entry (reusing the pinned `?seed=` session seed when present, fresh roll otherwise). End boss and portal progression reset each time the player re-enters the End.

## Nether portal-frame rules (normative)

Every tunnel mouth in the Nether carries a glowstone ring sized on its
carved opening (one centered pool lamp per ring via `netherRingLights` — rings
are portal structures, never chain-stride members), and every bore runs into
the central lava column. The siting
rules below are hard guarantees, not tuning — the generator constructs them
and the three-phase enforcement pass (re-clear bores/corridors, re-seal
shells, re-place rings last) re-asserts them per chunk:
- Uniform spread on the visible flank only: fan headings are stratified —
  one mouth per arc tenth over the facing hemisphere (`MOUTH_ARC` around the
  platform axis, `MOUTH_SEP` minimum separation, 10 distinct heights at or
  above `FAN_PLAT_MIN`); rear faces never host a frame. Three ground
  bridges per volcano are sited first on every volcano — before any fan
  anywhere, so exit tubes contend only with rock, lava and other bridges,
  never with the other volcano's long view corridors — one per arc sector
  (left, centre, right, `MOUTH_SEP` kept from the fan): each tip stands
    5..15 blocks clear of the flank   (`TIP_OVERHANG_MIN/MAX` on
    `tipD - radius`, whole visible run in 1-thick shell), either on a
    landing shelf grown jointly under the tip — flat shelf at `plat - 1`
    (`plat = NETHER_FIRE_LEVEL + 2..+4`), extending in front of the mouth;
    a failed shelf is rolled back, so orphans never clutter the sea — or
    right on flat island relief 0..10 above the sea (`spread ≤ 2`,
    `plat = shelfTop + 1`, the island doubles as the floor). No socle
    masonry anywhere — every mouth stands on rock. Outside the cone the
    walkway and corridor never touch island rock (`topAt ≤ plat - 1` over
    the whole bore+corridor footprint): low bridges route around fbm relief
    instead of carving it. Three bridges per volcano, guaranteed: sector
    slots (200 attempts each) then full-arc sweeps (2000 at half
    separation, 2000 at zero separation — the exact vetoes alone forbid any
    real overlap) and, only for still-empty slots, a carve fallback that
    lifts just the rock-touch veto (`t.carvedCorridor`, corridor rock sliced
    master-style; lava, pad, bands, frames and other tubes stay vetoed
    exactly as before) — strict re-site throughout, never clamped. Tips
    stay in their own volcano's half
    (Voronoi check) and clear of the central pad (`tubeHitsPad` ± 4), so the
    two volcanoes never crowd each other out; the fan still places its own
    ten around them.
    Bridges never cross each other
    outside the shared crater chamber (`MOUTH_SEP` + exact `tubesCross` +
    reservations; inside `craterR + 6` every envelope merges — the core is
    solid rock carved open identically, never void — so the chamber is a
    doorway, never a hole). A bridge touches only its own shelf islet
    if it has one (`tubeHitsDisc`), in both directions.
  - No cascade intersection: the ban mask (`buildCascadeMask`, bands plus 2
  cells) prefilters every lava veto and `courseClearance`/`boreBlocked`
  refuse any mouth whose walkway or ring touches a lava band, checked all
  the way from the crater edge to the mouth; the exact per-column span
  still decides where the mask is set, so a high walkway may thread over a
  low fall. Bands run from the crater lip down the cone, then drape over
  whatever island relief stands in the way until the lava sea (trench
  scanned while terrain stays above fire, cap foot+60), free from lip to
  water: no shelf (radius + 6), no bridge or fan envelope ever touches them.
  Tunnels never carry
  lava in the walkway, and the bore always reaches bare shaft lava with no
  rock wall left in between (floor lava capped to rock, so the walk stays dry
  and hole-free up to the lava face).
  - Big rugged fbm islands (master's two-scale noise recipe, capped at
  `FBM_TOP_MAX = FIRE+10`, one block below the lowest fan shell floor):
  `NETHER_LAND_OFFSET` (default 0 = current rendering) shifts the fbm base
  to tune the land share (~±10 ratio points per ∓2 around the ~1/3 default,
  useful range [-4, +4]; rivers stay absolute, the cap still bounds every
  island, siting vetoes unchanged — mean only, never per-seed variance).
  Rivers carve lava canyons through them, cliff streaks pour off their sea
  falls, lava bands drape over them — but no tunnel ever carves them. No
  island ever stands within 5 blocks of
  a lava band (`CASCADE_CLEAR` margin around each course over
  `[craterR, trenchEnd]`, hard carve like master's trenches — islands may
  stand anywhere beyond that, including between the two courses). Flat
  landing shelves for every bridge
  (`ISLET_TOP_MAX`, opened on the lava sea only, never on a cone, the pad,
  another shelf, a band (+ 6 margin) or a bridge envelope); low bridges
  route around island rock through the terrain veto. Fans sit a full band
  above every relief top (`FAN_PLAT_MIN`), so no fan envelope ever needs
  an island veto and corridors never slice an island.
- Ring sized on the carved mouth (`mouthCols`: integer columns with `d`
  within half a block of `dOut` and `f` in the band, 7–9 by heading):
  full-height jambs on the first/last columns, sill and lintel rows across
  (one deterministic hue per mouth, one rock sill cell under the ring when
  the ground dips). The frame glues flush to the wall face — never recessed,
  no niche — and always lands exactly on the opening edges, whatever the
  heading. A rock collar seals every face- and diagonal-neighbour of the
  ring that is not frame, walkway or corridor, within the mouth slice or
  behind it only (`frameCollarKeys`/`sealFrameCollar`, reserved like built
  rock, roof trim above the doorway like the shell's) — backing, never a
  lip in front — and a paved doorstep lowers the floor past the frame
  (`doorstepCells`/`sealDoorstep`, one below sill level over
  `dOut..dOut+1.5`, only air ever filled so the glowstone sill reads over
  it, reserved like built rock and known to
  the crossing test, never narrowing another tube's walkway or corridor), so no vertical slot
  and no doorstep pit survives between the glowstone jambs and the shell on
  any heading — the doorway front stays open by construction.
- Hermetic tube, no holes: every bore is carved open, then wrapped in a
  1-block lining hugging the walkway (floor `plat`, roof `plat+7`, one
  column per side — the rock reveal directly behind the frame ring), plus a
   second layer where buried — floor `plat-1`, roof `plat+8`, outer columns
   `f in {-2,9}` — but only at or below the natural surface (`y <= topAt`),
   or where rock stands within one cell sideways (1-block pillars closing
   the slot between lining and hillside): never a rock cap over the doorway
   or wings in open air, the volcano keeps its no-tunnel look, and no gap
   is ever left between rock and tunnel. Interior and shell are one partition of a single
  analytic band (`d` along the heading, `f = lateral + 4`; interior
  `0 <= f < 8`, buried shell `f in [-2,10)`, exposed shell `f in [-1,9)`,
  minus interior): a cell is one or the other, never both, never neither —
  no gap on any heading, no rock inside the walkway. The shell only ever
  fills air or lava outside the shaft, never touching another tube's
  interior (`tubeInteriorAt`), corridor, a frame (`ringCells`), the pad, or
  the shaft column. The only openings are the frame doorway and the lava
  face. `finishTunnel` derives `thinFrom` for every tunnel (backed up from
  the mouth while no rock rises above the floor), so fan and bridges alike
  wear 1 block in the open and 2 in rock.
- Full visibility of every block from the front: the full-width gallery bore
  (6 high, 8 wide from the mouth to the lava, no narrowing, no inner pillars —
   shell walls sit outside the doorway profile) plus the view corridor (10
     wide to the exit with the sill sight row at `y = plat` from the frame
  plane (disjoint by level from the lowered doorstep below), then the
  `plat+1..plat+7` band until open sky holds `APRON_OPEN` columns, capped at
  `APRON_CAP`) is cleared of rock — so zero stone stands in front of any
  glowstone block or inside the walk profile, by construction, at every
  mouth on every heading. The exit itself is two-tier: a
  fully open row within `EXIT_CAP`, else a shallow notch (overburden within
  `EXIT_NOTCH`) within `EXIT_FAR`, cleared the same way as a rock canyon. No
  lattice rounding anywhere in siting or construction: `boreBlocked`,
  `tubesCross` and every build pass decide per cell through the shared
  classifiers (`tubeInteriorAt`/`tubeCorridorAt`/`tubeShellAt`), and shells
  yield to any tube's airspace (`clearOf`), so a new mouth never punches a
  hole in an accepted tube and crossings are refused outright — except
  inside the shared crater chamber (`craterR + 6`), where every envelope
  merges by construction. Lava and glowstone are never touched, the pad is
  cleared through so a low corridor is never blocked. The walkway lava veto
  is exact per column (`boreBlocked` over the whole crater-to-mouth run,
  both volcanoes' bands included) — no lateral pre-gate, so a high walkway
  may honestly thread over a low fall.
- No stone pillar in or before any tunnel: the build carves the bore, seals
  the shell, places the ring, clears the corridor; the shell never fills a
  walkway cell.

## Extension points (dimensions and blocks)

- Dimensions are first-class: `DIMENSIONS` in `world/dimensions.js` is the registry (generator, sync + async, env preset, spawn, `arrival` portal-return policy, `frameKeys` worldgen frame index, `persistence`, respawnY floor (null = none), floor level (`floorY`: `0`, `null` = floorless), `infinite` streaming, `ambient`, `fullView`, moon/ultra/skyGrapple/tntTiersUnlocked props); `store.js` maps derive from `DIMENSION_KEYS` and a dimension may `registerRenderDist`, portals keep per-dim frame sets, and the main loop switches through `runTravel`. New dimensions register a spec beside the relevant world generator — no framework forks. Every dimension key is a valid `?startdim=<key>` boot target (`?startdim=nether` boots the Nether revealed: `fullView` skips the unload-horizon fog cap and the boot reveal, while the missing-chunk guard still hides unbuilt geometry). When a user requests a new dimension, ask them which URL key to use before implementation, then document and use it consistently. Infinite dims stream voxels through a `tntstream.js`-shaped lattice (deterministic cells, budgeted gen/evict, pinned player content); blasts in infinite dims clamp to the key range and ultras wipe per the dimension's ultra mode (bands in the overworld, ignition window elsewhere), never the whole level.
- Block ids append-only; dimension-specific blocks slot into BLOCK_INFO.
- The hotbar list is dynamic (add/remove/change); band or dimension swaps go in `hotbar.js` callers, and per-dimension lists come from `dimHotbar` (locked TNT tiers filtered there, never in the render). The End profile maps water to Moon Water and flower to Glowstone; the Nether maps water to Lava and flower to Glowstone. New tier families add their threshold to `tntunlock.js`.
- End portals enter the End from any dimension; inside the End they return to the Overworld. The generated return frame is protected, but its fill is disabled until dragon victory; every End re-entry regenerates the platform and return frame, respawns the dragon, and disables the return fill again.
- A distant body or occluded structure sharing a dimension's sky is a `REGIONS` entry (`contains` + `factor` + optional `onFade`), never a mesher fork.

## Dropped from master (kept out on purpose)

Saves and server API, jump streak boost.
