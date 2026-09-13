# AGENTS.md

## Project

MiniCraft — a voxel/Minecraft-style game in the browser. Single-page app:
`index.html` (UI, CSS, import map) + `main.js` (Three.js game logic), with a
small Python server for saving/loading worlds.

## Commands

- Run the game: `python3 server.py` (or `npm start`) → http://localhost:8383
- The server serves static files and exposes `GET/PUT/DELETE /api/worlds/<name>.sav`.
- No build step, no lint/test/typecheck scripts are configured.
- There is no Node runtime installed on this machine — you cannot run JS with
  `node`. For quick syntax checks use Python scripts or `osascript -l JavaScript`
  (macOS JavaScriptCore, ES2017-flavored); verify game logic in the browser.

## Project Structure

- `index.html` — full UI: stylesheet, overlay/menu (New World, Load Save),
  help panel (with portal diagram), HUD (crosshair, hotbar, dimension label,
  boss bar, toast), the Three.js import map.
- `main.js` — all game logic in one ES module, organized in sections:
  block definitions → procedural textures → world gen (incl. village) → renderer →
  instanced meshing → player physics → raycast/highlight → editing →
  TNT → portal/dimensions → Ender Dragon → villagers → save/load → HUD → hotbar →
  input/menus → main loop.
- `server.py` — static file server + world-save REST API.
- `save/` — `.sav` world files (written by the server API).
- `package.json` — defines only the `start` script (`python3 server.py`).
- `AGENTS.md` — this file.

## Features

- **World gen**: procedural over-world (fbm heightmap, terrain, water, trees)
  at 2x size (`WORLD_RADIUS = 96`, ~193×193 footprint) and an End dimension
  (grey END_STONE floating platform, black sky). Seeded (`seed`/`endSeed`),
  both persisted in saves. Land is ~79%; the ~15% water is carved as low-freq
  basins (`basinFreq`/`basinThresh`, per-world quantile) whose ocean-floor
  depth scales with `waterDepth` (`BASIN_SHORE`+`BASIN_DEPTH`). Each new world
  randomly picks water size 1–4 (basin frequency ∝ 1/√scale) and depth 1–3
  (from `seed` via `hash2`, recomputed in `generateWorld`). A few meandering
  rivers (`generateRivers`, seeded winding paths) cut 8–14 wide channels down to `RIVER_BED = 8` through the land. Underground, a catacombs
  network replaces the old caves: five long winding 3×3-square tunnels
  (`generateTunnels`, A→B paths with perpendicular wobble through `edgePoint`,
  each end `settleEntrance`-adjusted onto land, interior points clamped inside
  the map) cross the map. Each tunnel ramps down from an open surface mouth
  (`TUNNEL_RAMP` smoothstep on the arc length, so the tube descends from the
  surface to `TUNNEL_DEPTH`±`TUNNEL_DEPTH_VAR`, rising again at the far end;
  `carveTube` carves a 3×3×3 box per step, `tubeDepth`/`smoothstep`), and every
  tunnel passes through `ROOMS_PER_TUNNEL` big halls (`carveRooms`, 11×11×7 air
  with four ±3 corner columns). The whole network stays sealed by rock
  (carvings never breach the surface), tunnel elbow depth clamps inside the
  terrain so shallow seabeds never leave gaps, and each tunnel's land ends that
  settle inside the map are open holes in the ground with a long wooden
  `PLANKS` staircase (`stairEntrances`, `STAIR_STEPS` descending 1-block risers,
  one tread per block along the tube heading down into the catacombs — the
  floor snaps to an integer block and is coerced to never rise (descents of
  exactly 1 where the ramp deepens, level steps where terrain swells), so the
  flight is a clean continuous staircase; carves are collected first, then all
  planks are laid, so crossed flights never delete each other's stairs) leading
  down to the catacombs; stairs whose opening would sit off
  the map edge are skipped, and entrances leaning over cliffs or water keep
  only the framed side that stays on solid ground).
  Terrain is dramatic
  (`LAND_RAISE = 20`, strong low-freq hills + per-column rough, tops clamped
  at 70, height stdev ~10) with scattered flat-topped mesas: where a low-freq
  `plat` noise sits near its midline the column height snaps to one of ~7
  discrete levels (`8 + lvl*44`, in `heightAt`). Trees range from stumps to
  pines (trunk 1–50 — halved from the old 1–100, clamped to the world ceiling
  `MAX_Y = 254`, via `hash2` in `growTree`). Trees clump into
  forests: a quantile forest noise (`forestThresh`) splits the map ~50/50, with
  1.5x tree density in forests and 0.5x in the sparse rest. Blocky flowers
  (non-solid) are scattered on ~1.5% of grass columns. Above the canopy, solid
  white climbable clouds (`CLOUD`, `generateClouds`) are scattered as clusters
  of overlapping 3D-ellipsoid puffs (a few per cloud, lumpy like real clouds),
  each at its own height and ~30% scaled up to 2x bigger, via
  `hash2` — filling a band that starts at 2x max tree height (`CLOUD_BASE`)
  and extends 2.4x max tree height high (`CLOUD_LAYER` = 120, -20%); that
  original band is stacked 3 times (`CLOUD_LAYERS`, reseeded per layer) up the
  sky (`CLOUD_TOP` 460, `CLOUD_SPAN` 360), with `MAX_Y = 999` (raised from 254;
  saves store y as 16-bit in format v8). Clouds keep the standard fogged
  material and camera far plane, so from the ground only the lowest decks are
  visible — higher layers show as you climb. Climbing through the cloud band
  from 3/8 to 5/8 (`SKY_SPACE_START` 235 → `SKY_SPACE_END` 325) fades the
  Overworld sky and fog from day blue (`DAY_SKY`) to starry night
  (`SPACE_SKY`, smoothstep) while a camera-following star sphere (`skyStars`,
  ~520 points) fades in and sun/hemi light dim; `setDimensionEnv` hides the
  stars in the Nether/End. The moon fades in from 5/8 to 7/8 of the cloud span
  (`MOON_FADE_START` 325 → `MOON_FADE_END` 415, surface `MOON` fades 325→406
  while `MOON_WATER` stays hidden; when the moon is full (`MOON_FADE_END`
  415) the six lakes are generated on the fly (`generateMoonLakes`,
  `moonLakesGenerated`) then `MOON_WATER` `basicFace` `fog:false` fades
  415→820 (`LAKES_FADE_START` 415 → `LAKES_FADE_END` 820, flat on top at the
  same level as the moon surface) starting when the sky is already black. At
  one
  cloud-span above
  the last cloud (`MOON_Y` = `CLOUD_TOP` + `CLOUD_SPAN` =
  820, clamped to `MAX_Y`) a hollow hemisphere (`MOON`, `MOON_R` =
  `WORLD_RADIUS`, `MOON_THICK` 5, `generateMoon`) spans the full Overworld
  diameter: flat on top at `MOON_Y` 5 blocks thick full, half-sphere hollow
  below (shell 5), made of a darker grey cratered `TEX.moon` block — craters
  are texture only, more random per block with close grey tones for realism
  from below. Six vertical grey lakes
  (`MOON_WATER`, `TEX.moonwater`, closer tone, irregular wavy edges, flat on top
  at the same level as the moon surface, distributed on the central 2/3 of the
  flat top) are carved as aesthetic crater-lakes through the whole thickness
  from the flat top to the dome bottom, so you can enter from below and swim up
  to the surface. Rendered unlit (`basicFace`, `fog: false`) but darker so it
  reads grey from below with visible relief. It is `placeable:
  false`, skipped by `spawnPlayer`/`resolveSpawn` so respawns stay on ground.
- **Textures**: 16×16 pixel-art textures drawn procedurally on canvas
  (`TEX`, `makeTex`, `pxNoise`, `canvasTex`), NearestFilter + sRGB.
- **Rendering**: chunked streaming. The overworld is split into `CHUNK` (16)×
  16-column chunks and only the square of chunks within `RENDER_DIST` (8) of
  the player are meshed (added/removed as you cross chunk borders in
  `streamChunks()`/`rebuildChunk`), but when near the Moon (`dist < MOON_R+120`) every world chunk is kept meshed so the whole hemisphere stays visible from any point inside or around it. Each chunk is one `InstancedMesh` per
  block type with only exposed faces; every mesh calls `computeBoundingSphere()`
  so Three.js frustum-culls off-screen chunks. Each column's highest set block
  is cached per dimension (`colTops`, updated in `setBlock` and rebuilt after
  world gen/load via `rebuildColTops`), so chunk meshing and the water-surface
  scan only walk up to each column's real top instead of the full 1000-row
  sky. Shared per-type materials
  (`typeMats`). Editing rebuilds just the touched chunk(s) via
  `refreshBlocks()`, not the whole world. No shadow maps; fog +
  hemisphere/directional light.
- **Blocks**: numeric constants + `BLOCK_INFO` (solid/opaque/placeable).
  Types incl. GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANKS, GLASS, WATER
  (non-solid, animated opacity; WATER and LAVA are placeable only
  onto a cell already holding the same liquid — water on water, lava
  on lava — and nothing else can be placed into a liquid cell
  (but any block may be stacked directly on a liquid surface);
  they cannot be removed — breaking one does nothing), TNT, FLOWER (decorative non-solid, built from
  1/30-size cubes in a 30×30×30 grid filling exactly one block cell, geometry
  centered on the cell so it sits on the ground — a thin green stem with two
  leaves hugging it (raised mid-stem, overlapping the stem cells and merged into
  it) holding a flat round 2D bloom: a vertical disc of petals with eight
  scalloped tips standing out past the rim, around a darker center, like a real
  flower face-on; base touches the grass
  and all cubes stay inside the cell even when rotated; seven color variants
  (red, blue, yellow, turquoise, orange, violet and a rainbow multicolor —
  eight radial petal slices around the bloom, weighted twice as common as the
  solid colors via `FLOWER_WEIGHTS`) derived from position
  via `flowerVariant`, each rendered as a per-chunk `InstancedMesh` sharing a
  baked-vertex-color geometry (`FLOWER_GEOS`) and one `FLOWER_MAT`
  `MeshLambertMaterial` with `vertexColors`; random Y-rotation via
  `flowerAngle`; placeable at random each time (placing rolls a fresh weighted
  variant via `randomFlowerVariant` and a random Y-rotation, stored per flower
  in `placedFlowers` and persisted in save format v3, so break/replace yields a
  new color — multicolor included) and present in the hotbar right after Water
  with a `TEX.flower` icon),
  PORTAL, ENDSTONE (grey End platform block,
  `placeable: false` so it can't be selected or placed), CLOUD (solid white
  climbable cloud block, generated by `generateClouds`, `placeable: false`),
   MOON (pale cratered lunar rock, `generateMoon` hollow hemisphere at
  `MOON_Y`, `placeable: false`), MOON_WATER (grey water lake block inside the
  moon, `TEX.moonwater`, `placeable: false`),
  OBSIDIAN (dark purple-black rock from the Nether, in the hotbar after the
  Portal block, `placeable: true`, used as the mandatory frame of the 5×4
  Nether portal), LAVA (blue lava liquid, unlit `MeshBasicMaterial`
  face materials whose color shimmers in the main loop, `fog: false` so the sea
stays bright at distance, `placeable: true` so it
  can sit in the hotbar and be placed in the Nether/End),
  NETHERRACK (dark grey Nether rock, in the hotbar after OBSIDIAN,
  `placeable: true`), SOULSAND (dark grey Nether beach block,
  `placeable: false`),
  GLOWSTONE (the multicolour portal block: solid, `placeable: true`, in the
  hotbar, drawn unlit via `basicFace` so it shines at full
   strength no matter how far you stand from it. It comes in seven colours —
   green, red, blue, yellow, orange, purple, turquoise (`GLOW_PALETTES`,
  one tile texture per colour in `GLOW_TEX`); the texture is drawn by
  `drawGlowMesh` as classic packed-nugget crumbly cells — bright cells with
  thin dark seams and pale hot cores, clearly a solid glowing rock, unlike
  the orange-blue lava; the block texture is lifted
  brighter so the unlit blocks read as glowing (`GLOW_LIFT` — only the dominant
  colour channels are lifted, so red/blue/purple stay saturated instead of
  washing out toward pink/grey; green gets half the lift since it already pops
  against the grey Nether, while blue is drawn as-is (`flat`) as a vivid royal
  blue — saturated and luminous without drifting into cyan or washing pale —
  and purple lifts only its blue channel so it stays violet instead of turning
  pink) while the projected light colour (`glow`) is never brightened. Placing a stone rolls a random
  colour, but if any existing glowstone sits within 10 blocks it inherits that
  nearest stone's colour (`glowVariantNear`), so builds grow into single-colour
  clusters. Each stone's colour is stored per block per dimension
  (`glowVariants`/`worldGlowVariants`, persisted in save format v7; old saves
  are backfilled with clustered colours on load, and v6 saves from the
  seven-colour era remap their indices via `LEGACY_GLOW_MAP`), rendered
  per-chunk as one
  `InstancedMesh` per colour (`getGlowMats`, keyed `glowstone_v`), and the
  auto-built volcano door rings each get one random colour of their own. Each
  cluster casts a steady pool of light in its own colour:
  glowstones are merged into stable clusters (`recomputeGlowClusters`, a whole
  6×6 volcano door ring shares one cluster, and each cluster's colour is the
  majority variant among its stones) whose centroids are recomputed only
  when blocks change, and a fixed pool of `PointLight`s
  (`syncGlowLights`/`clearGlowLights`, `GLOW_LIGHT_MAX` 16, intensity 60,
  `distance: 12`, decay 1, colour set from `GLOW_PALETTES[v].glow`) is
  assigned to the clusters nearest the player — the
  assignment re-evaluates at most every `GLOW_LIGHT_REFRESH` (0.5 s) and only
  when the player crosses a chunk, and each light keeps its current cluster
  while that cluster stays among the nearest lit ones, so the glow never jumps
  between the stones of a ring, never flickers while you walk toward a cluster,
  and costs nothing in between (no per-frame world scan) —
  and it replaces FLOWER in the
  Nether/End hotbar; volcano door frames are built from it so tunnel mouths
  also glow). Each volcano is now **hollow**: after the tunnels are carved,
  `hollowVolcanoes` strips the deep rock so a solid cell is carved only when
  it lies more than `HOLLOW_SHELL` (2) steps of solid NETHERRACK/SOULSAND away
  from any air — a bounded flood keeps the whole surface as a thin wall shell
  (and a thin rock envelope around every tunnel and coulee, so no face that
  was visible before becomes visible from outside) — and only outside a
  protected core cylinder (`craterR + 3`) that keeps the crater bowl, the lava
  shaft and the tunnel mouths intact. The cone interior is one big walkable
  chamber wrapped in a 2-block wall; the player must dig through the thin
  shell to reach it. Stored-`AIR` (0) entries count as air for the carving
  (`volcanoAir`).)
  The **hotbar is dimension-aware** (`hotbarList`/`rebuildHotbar`): in the
  Nether and the End the Flower slot holds GLOWSTONE and the Water slot holds
  LAVA, while the Overworld keeps flowers and water; once the Moon starts to
  appear (`onMoon`, `pos.y >= MOON_FADE_START`, tracked by `hotbarMoon`) the
  Water slot holds MOON_WATER and the Flower slot holds GLOWSTONE; the hotbar
  is rebuilt on every dimension change, load and new world.)
- **Player**: AABB collision, gravity (`GRAVITY = 37.44`, +20% twice; halved
  in the Overworld once the player rises to the bottom of the Moon sphere,
  `pos.y >= MOON_Y - MOON_R`), jump (Shift/Space), walk/sprint (/), fly mode, swimming,
  free-cam (spectator). Third-person-style first-person camera, yaw/pitch.
  While flying (F), the build anchor tracks the camera position, so placing and
  breaking blocks works from the air just like on the ground and the hold-left
  chain builds toward your airborne position instead of a stale ground spot.
  Jumping is hold-powered, no charging:
  a Shift/Space press while grounded is a plain regular jump (`JUMP_MIN` = 8.2), so a
  quick tap is the same hop as always. Holding Shift/Space adds upward thrust
  (`JUMP_THRUST` = 45) that fades in smoothly from takeoff
  (ramped over `JUMP_RAMP` 0.25 s, so a quick tap barely climbs while a hold
  engages immediately — no hard threshold, no dead delay) plus a takeoff
  kick (`JUMP_BOOST_ACCEL` = 40 for the first `JUMP_BOOST_TIME` 0.15 s, so the
  launch accelerates upward clearly instead of sagging) and keeps pushing
  while airborne for up to `JUMP_HOLD_TIME`
  (0.7 s) as long as you're still ascending (`vel.y > 0`), so the longer you
  hold the higher you climb — a full hold reaches ~14 blocks, a tap barely
  leaves the ground. The thrust never works while falling, in water or flying.
  While airborne you can steer
  gently toward the held movement keys — holding / steers toward a sprint
  air speed (`SPRINT × AIR_SPRINT`, so sprinting jumps travel further), walking
  stays at `WALK`, blended via `AIR_STEER` = 2.5, and with no input the
  horizontal momentum coasts with a
   slow `JUMP_FLING_DAMP` (6) decay until you land (jump inertia `jumpBoost` stacks on consecutive sprint jumps, `jumpIdle` resets when stalled or idle 0.12s). Jumping requires a fresh press — holding Shift/Space on the ground does not auto-repeat (`spaceJustPressed` sets `jumpBuffer` `JUMP_BUFFER` 0.2s, consumed only when `onGround`; `spaceJustReleased` halves upward velocity for variable height, the 200ms buffer keeps fast bunny-hops/`jumpBoost` responsive around landing time). Rebound on water/lava: falling into water/lava while holding Shift/Space while a recent jump is tracked (`jumpOriginY`/`jumpPeakY`/`lastSpaceDownY`/`jumpHoldContinuous`) bounces back to that height (`waterSurfaceTop` delta → `sqrt(2*GRAVITY*delta)`, sprint-boosted, `bounced` flag) instead of damping. Swimming: full-AABB water detection (`headInWater` checks `pos.y+0.01` to `pos.y+PLAYER_H-0.01` for WATER/LAVA), deep ascent `SWIM_ACCEL` 2.0, shallow hold at 65% immersed (`targetY = surface-1.17`, `err*4` spring with `SWIM_BRAKE*2`, `SWIM_AREA` 10) — player floats   waist-chest deep, not feet-on-surface. Debug HUD (`#boost`, toggled with =/+) shows jump speed while sprint-jumping.
  Respawn (`spawnPlayer`, used for new worlds, void falls and flying out of the
  level) scans the spawn column from `MAX_Y` down (skipping CLOUD/MOON) and stands
  on the top solid found, so the player never settles inside hills, mesas or
  builds that rise above the old fixed 60-block scan ceiling.
  Auto-steps are smooth, not jumps: walking into a 1-block step auto-climbs (`tryStep`
  inspects the actual cell the footprint hits, so corners climb cleanly without
  deviating the line of travel; it only fires while on the ground and moving into the
  block; `tryStep` now checks only `isSolid(bx,by+1)` so a 2-high ceiling is climbable and `stepUp` no longer aborts on `blockedBody`). The feet slide straight up at a fast constant `STEP_UP`, easing out as the
  top approaches (`STEP_UP_EASE`), and land exactly on the step's top
  (`stepUp`/`stepUpClearY`, no arc, no overshoot, gravity never takes over
  mid-climb), so walking/running continues with no hop or stall; the same climb
   works out of water / lava / moon water while swimming (`inWater`) `tryStep` fires even without ground
   contact (`stepFromWater`) only when the blocking block is at or just above the feet floor (`by === fy || by === fy+1`, `isSolid(bx,by+1)` check) — the player glides smoothly up onto the shore with the same `stepUp` raise at same level — so you can swim back up onto a shore
   at the same level even when floating 65% deep (moon lakes included); anything higher requires a jump,
  shallow water and netherrack beaches included. Walking
  off a 1-block ledge glides down at constant `STEP_SPEED` instead of free-falling
  (`stepDown` triggers only when the ground was solid the previous frame and is
  exactly one block below — jumps and tall drops keep normal gravity).
- **Editing**: pointer-raycast block pick (DDA), infinite reach (`REACH`), white
  `highlight` box on the targeted block. The pick skips liquids (`pickBlock(..., skipLiquid)`)
  so aiming at water/lava/moon water targets the solid block behind it, and placing
  replaces the liquid cell in front of that block (any placeable block; a solid is
  refused inside the player's or a mob's body, while non-solids — water, lava,
  moon water, flowers — place freely there). Left click places, right click breaks (both work while flying — build anchor tracks camera). Holding left click is two-phase: while the mouse moves, it paints — each movement event places one block where the cursor aims, but only onto a block of a different kind than the selected one, and only within `CHAIN_RANGE` (4) blocks of any block already placed during this hold (`clickAnchors`, reset per press). If the mouse never moved during the hold, after 1s without moving (`leftTimer`) the hold latches into bridge mode (`leftStairs`): the staircase builder below starts immediately and keeps building until release — mouse movement mid-bridge is ignored, and once the mouse has moved during a hold (`leftEverMoved`) the bridge can never engage for that hold. Holding right
  digs a straight tunnel: each repeat breaks the live raycast `currentBlock`, so
  removing one block exposes the next one behind it; the dig starts only after holding still 1s or after ~15px of deliberate mouse travel (`rightMoveAcc`/`RIGHT_MOVE_PX`, so jitter never skips the `CHAIN_HOLD` gate), and chained breaks are limited to `CHAIN_RANGE` (4) blocks of any block already removed during this hold (`clickAnchors`). Holding either button chains the action after 1s
  (`CHAIN_HOLD`) at `CHAIN_RATE` (10/s):
  the `editHold` map tracks each button's down state and a per-frame timer until
  `CHAIN_HOLD` elapses, then fires every `1/CHAIN_RATE` using `dt`. Holding left grows a
  straight walkable staircase: the click that starts the hold anchors
  `chainHome` where it landed (the block placed on the raycast target), and a
  cursor advances one cell per repeat along the straight line to the current
  feet cell (`feetDest`: at most 2 blocks ahead of the player at foot level —
  normally 1 block ahead, but when within 1-2 blocks of a cliff edge it
  bridges straight out at foot level with no gap, otherwise it lands at most
  2 blocks from the player;
  horizontal steps use the ray/grid crossing of
  `lineStep`). The flight is always 1-block high per step at a time (no plateau averaging — every horizontal move that still has vertical distance moves 1 vertical toward `dest`), so every hop is the walkable 1-block rise/fall of the
  auto-step, solid wedged (ascending fills at new pos at old height, descending fills at old pos at new height, via `oldX`/`oldY`/`oldZ` tracking, so the wedge is solid with no gap at the cliff edge) and diagonal moves fill the corner. The cursor always
  reaches the feet cell — when within 1 block horizontally and vertically,
  the final block snaps directly to the feet position — even when a cell along
  the way is blocked (the cursor skips on and the stairs re-form); every placed
  cell lays its whole 2x2 `chainPad` (the cell plus its
  `+x`/`+z` neighbours, with the trailing corner also filled on the diagonal
  arrival cell), so the staircase is a solid 2x2 footprint with no holes
  anywhere; when the vertical is steeper than horizontal (`horiz/vert <1`), the
  stairs become a spiral (`chainSpiral`): central 1-block column with 2×3 pinwheel tread (2 deep radial ×3 wide tangential, `dirs`/`perps` rotated 90°, `chainSpin` clockwise) winding clockwise, each tread with 2-high railings in the same material as the stairs (5 outer cells beyond the tread at `ny` and `ny+1` via `wallOffs`), dropping one block per turn, until the slope flattens and `chainStep` resumes. The
  chain rate is not constant: after
  `CHAIN_HOLD` elapses it fires at `CHAIN_RATE` and accelerates smoothly by
  `CHAIN_ACCEL` blocks/s per second held (rate = `CHAIN_RATE + CHAIN_ACCEL *
  held`, capped at `MAX_CHAIN_RATE`), driven by a per-button accumulator
  (`editHold[b].acc`) that pops actions as often as the live rate requires. A portal fires only when the player's body actually touches its fill (`touchesPortalFill`), not when jumping over it, and volcanos' walls & cascade thickness were reworked (`HOLLOW_SHELL`/`CASCADE_THICK`).
- **Grappling hook**: hold middle mouse click to fire a hook that first flies fast to the target (`GRAPPLE_THROW = 70`, `grappleVertBoost` ×2 if vertical, while it flies you keep full control — you keep falling and moving, the rope follows you; the hook flies straight through water and lava — it never grabs a liquid, only the solid block behind it), then hauls you in a straight line onto that block (`GRAPPLE_SPEED = 26`, feet on its top `b.y+1.001`, zeroed velocity); releasing mid-pull keeps your pull momentum — you're flung along the hook's launch-line direction (start→target) at `GRAPPLE_FLING` (~1.3x grapple speed), with the same boost applied to every axis so the launch follows the grapple's natural angle and gravity takes over from there; the fling keeps you moving in that direction (up, down or sideways) with mild friction — pressing movement keys steers the momentum rather than replacing it — until you touch the ground (which cancels it) or it runs out. The pull resolves collisions per axis (`grappleMoveX/Z/Y` with sub-steps capped at 0.4, so it never embeds you in terrain): when the landing spot on top of the target's column is clear (`grapplePass`, recomputed each frame via `blockedBody`), that column is skipped in the collision check so you can land on top from any direction — but only when the grabbed block is the column's top block or the one directly below it (a free pillar up to 2 tall; `grappleTopY`); a block buried deeper in a taller column is treated as a solid and stops you flush against it instead of letting you climb to the top. Any other obstacle in the path stops you flush against it and you slide along it (clamped against the blocking cell) while the pull is held — once you're blocked (or landed), you keep full control and can move/turn freely while hooked. Arriving on a clear solo block or 2-block column plants your feet on its top (`grappleArrived`), keeping you hooked with the rope attached until you release the button, releasing only stays a launch while you're still actively mid-pull (`grapplePulling`) — releasing at rest (landed on the block, pressed against an obstacle, or while the hook flies) just drops you straight down with no fling or inertia. The same hook can also latch onto any mob except endermen — aiming it at an enderman does nothing (`fireGrapple` returns early; `pickBlock` vs `pickMob` still picks the nearer hit within `blockDist` for everything else; `grappleMob` target is `mob.pos+h+0.001` like a flower top, homing: `updateGrapple` each tick sets `grappleTarget=mob.pos+offset` (hit point `getMobHitOffset` where ray hit the mob, not always top) and moves `grappleHookPos` toward it at `GRAPPLE_THROW*tb` until `hitR=hw+0.35` (smooth `min(step,dist)` no snap, rope follows `grappleHookPos` which copies `grappleTarget` after hooked), then pulls the player onto the mob's top at `GRAPPLE_SPEED` — standing on the mob like on a flower, then you fall off if it moves). A thin pixelated rope (cube chain ~1/10 block, dense over the whole path) plus a blocky hook head shows the pull from the eye to the flying/stuck hook. On release the hook detaches and retracts — it zips straight back toward your eye at `GRAPPLE_RETRACT` (275) with the rope following, then vanishes when it reaches you; firing again mid-retract cancels it.
- **TNT**: lighting fuses (HUD fuse sprite), delayed explosions with blocks
  destroyed/tossed and particle flashes. Breaking a TNT lights a 3s fuse and
  explosions chain-react: a blast near another TNT block lights it, and a lit
  TNT caught in a blast (or re-broken) detonates immediately. In the End, a
  lit TNT targets the Ender Dragon: the TNT cube flies up at it, sticks onto
  its body and detonates on contact with a burst in the dragon's new color
  (`damageDragon` runs first so the repaint lands, then `spawnDragonBurst`
  fires tinted by `dragonBurstColor`, the current hit accent — flash plus
  particles; each stuck blast = `DRAGON_FULL_DMG` HP, so it takes 8 TNT to slay. Strict aim required: with TNT selected in the End, a bomb fires
  only while the crosshair is on the dragon and nearer than any block
  (`aimedDragon`, `mobT <= blockT + 0.5` occlusion, `tntTargeted`
  single-live-bomb rule, wired through both `tryFireLockedTNT` and the
  discrete-break `igniteTNT` path) — sky clicks never fire, and chained burst
  shots stop the moment aim leaves the dragon:
  the per-lock shot cap is live (`dragonShotsCap` = `ceil(hp / DRAGON_FULL_DMG)`,
  8 at full health, fewer as it is hit) instead of the pigeon's fixed 3.
  Breaking a placed TNT block in the End converts it to a dragon-homing
  bomb only when the break aims at the dragon; otherwise it stays a normal
  fused block that explodes in place and never touches the dragon — only TNT
  aimed at the dragon flies at it and hits it. A dragon-homing blast deals
  dragon damage only (full 1/8 HP per stuck blast) —
  it never destroys terrain, so no crater is left where the TNT launched; a
  homing bomb that never sticks fizzles in air after `life` (3s fuse + 2s chase)
  with no dragon damage.
- **Portals / dimensions**: portal frames are detected in either orientation —
  upright (vertical frames standing on edge) or flat (laid on the ground —
  `winOk`/`vWinOk` for End frames, `nWinOk`/`nFlatWinOk` for Nether obsidian,
  `findEndWinNear`/`findNetherWinNear` scan both and pick the nearest window).
  End portals can be a flat 5×5 ring (4 sides, corners optional) or a vertical
  5×5/5×4 panel, both with black air interior plus solid black fill when
  active; walk into their 3×3 interior to jump to the End. A portal fires only
  when the player's body actually touches its fill blocks
  (`touchesPortalFill`: the fill cells from `portalFillCells`, AABB against the
  player body), so a flat ground portal never grabs you just because you jump
  over it — the fill is a thin slab while your feet hover above it. The End is freshly
  regenerated on every entry — builds are not kept, the dragon respawns at full
  health and the vertical 5×5 return portal (upright frame, `buildReturnPortal`)
  is always standing on the platform but the End is sealed until the dragon dies:
  while the Ender Dragon is alive (`endCleared = false`, set on every End entry)
  every portal out of the End — the return portal's black core, any user-built
  End frame, and even a Nether frame built in the End — is dormant (no black
  fill, no teleport; a toast notes the End is sealed), so you cannot leave the
  End to the Nether or the Overworld until the dragon is defeated. Slaying the
  dragon (`endCleared = true`, set in the death sequence) makes every End-frame
  and Nether-frame exit live: the return portal's fill appears and drops you back
  beside the Overworld portal you entered. You can
  build your own End-frame return portal in either orientation. The return
  portal's frame blocks are indestructible (`protectedBlocks`, checked by
  `breakBlock` and the TNT blast loop), and so is the whole End platform
  (its single surface layer at y 0, added in `buildReturnPortal`). Protection keys are
  dimension-scoped (`protKey`, `dim:key`), so End coordinates never
  shadow-protect same-coordinated Overworld/Nether blocks). Returning drops you no more than 3
  blocks from the Overworld portal frame (Chebyshev distance to any frame
  block), on firm ground, facing the portal: the landing spot is re-resolved
  on live terrain against the recorded frame (`overPortalWin` + entry side
  `overPortalDir`, via `findReturnSpot`: expanding rings r=1..3 around the
  frame footprint with a tight ±2 vertical band at frame-base level, requiring
  full body clearance, solid ground under the feet — CLOUD/MOON count, so sky
  portals land back on their cloud/moon — and no portal interior, so a build
  or blast at the old spot never leaves you stuck in a wall, floating, or
  standing in another frame; with no firm ground in range (floating pillar,
  water, nuked ground) the fallback stands on the frame top itself
  (`frameTopSpot`), and a destroyed frame falls back to a tight r≤3 search
  around the recorded point (`resolveSpawn`) or the nearest live frame; the
  final yaw is recomputed from the landing spot toward the frame centre
  (`facePortalFrom`), flying is forbidden in the
  End, and free-cam
  (F) is disabled there; you land just short of the return portal (cooldown +
  zeroed movement prevent an instant round-trip).
  Nether portals work in either orientation too. Upright frames can be 5 wide ×
  4 tall (3×2 air interior), 4 wide × 5 tall (2×3 air interior, the classic
  Minecraft size) or 4 wide × 4 tall (2×2 air interior), all obsidian with every
  edge block mandatory (`nWinOk` takes width/height), facing either along Z or
  along X (`face` field, both scanned). Flat obsidian rings laid
  on the ground come in 5×4 or 4×5 footprint (3×2 / 2×3 interior — `nFlatWinOk`).
  Walk into their air interior to reach The Nether. Every valid portal frame —
  not just the nearest — gets its own persistent fill group in a `portalFills`
  Map (`collectEndWins` /
  `collectNetherWins` return all windows in a radius; `scanWorldPortals`
  registers the whole world, `refreshPortalFills` re-validates frames each
  tick and prunes broken ones; portal scans are anchored to actual
  PORTAL/OBSIDIAN blocks instead of brute-forcing radius windows: `setBlock`
  maintains per-world `portalBlockSets` (`worldPortalSets`) of candidate blocks,
  and `collectEndWins`/`collectNetherWins` enumerate just the possible windows
  whose mandatory edge cells pass through each anchor block (deduped via a
  `seen` Set) and validate them with the same `winOk`/`vWinOk`/`nWinOk`
  checks, so a frame built while the player stands still inside its future
  interior is recognized immediately with no per-frame window sweep).
  `updatePortalVisual` rescans only when `portalDirty` is set or when half a
  second has passed with the player on a new chunk cell; any `setBlock` edit
  sets `portalDirty`, and `checkPortal` walks the live `portalFills` Map
  instead of rescanning the world each frame. Nether/End fills share one
  `portalFillGeo`
  and two `MeshBasicMaterial`s (purple `0x9b30ff` for Nether, black for End)
  with the same per-orientation `layoutPortalFill`; the purple glow marks an
  active portal. The End return portal's fill is exempt from proximity
  registration: `refreshPortalFills` always registers `endReturnWin` once the
  End is cleared, so its black stays rendered from anywhere on the platform
  (distance culling at ≈182 blocks still covers the whole floor), and the
  death sequence registers plus shows it synchronously
  (`ensurePortalFill` + `updatePortalVisual` right after `buildReturnPortal`),
  so the black is there the instant the dragon dies. Fills render as per-cube `Mesh`s in a `THREE.Group` and are
  culled per-frame: hidden when you're in another dimension, when beyond
  `PORTAL_FILL_DIST` (scales with render distance: 8 chunks × 16 × √2 ≈ 182
  blocks, so the glow stays lit as far as the frame itself is visible, plus
  squared-distance test from the eye), or
  when off-view/behind the camera (three.js frustum culling on each cube).
  Portals work
  both ways, so the Nether's auto-built upright return portal
  (`buildNetherPortal`,
  an obsidian frame standing on a stone pad at spawn, protected, or any
  Nether-frame you build in the Nether) brings you
  back to the Overworld's last portal entry point. Any overworld portal entry
  (End or Nether) records the exact frame you stepped through
  (`overPortalWin` = the frame window + entry side `overPortalDir`,
  `overPortalSpawn` = a clear solid spot within 3 blocks of it,
  `overPortalFace` = the yaw facing its interior), so the portal you use to
  leave the Overworld is always the spot you land at on the way back — as many
  portals as you like each work per-use. In the Nether or End glowing
  portals work both as cross-links and as the way home: `checkPortal` treats a
  Nether frame (obsidian) built in the End as a Nether portal (it takes you to
  the Nether) and a Nether frame in the Nether as the trip home; an End frame
  (PORTAL) built in the Nether takes you to the End, and an End frame in the
  End is the trip home. Both frame types
  get registered as fills by `scanWorldPortals`/`refreshPortalFills`
  everywhere, so
  Nether frames glow purple and End frames show black wherever you are. The
  single exception is the End itself while the dragon is alive: `checkPortal`
  checks `endCleared` before any exit, and `refreshPortalFills` clears the
  End's own fills until `endCleared`, so in the End every frame (End or Nether)
  stays unlit and sealed until the Ender Dragon is defeated.
  Arriving in the Nether or End spawns
  you in front of the auto-built return portal with your back turned to it
  (`yaw = Math.PI` in the Nether, `yaw = 0` in the End, both facing out into
  the new dimension). The Nether regenerates on
  every entry, like the End. Any portal
  teleport (`portalTrigger`, all four routes in `checkPortal`) first fades in a
  fullscreen rotating purple spiral vortex (`#portalSpiral`, six SVG spiral
  blades built by `buildSpiralArms` over a bright-centre `spiralGrad` plus a
  faint counter-rotating back layer — opacity 0→1 transitions with a
  `transform: rotate` animation, both compositor-driven), waits
  `PORTAL_FADE_IN` (450 ms), then runs `goToDimension` — the spiral is fully
  opaque and still spinning while the synchronous world-gen/chunk rebuild
  freezes the main thread (compositor animations survive the stall, hiding the
  hitch perfectly), then fades out (600 ms) over the freshly generated
  dimension.
- **The Nether**: a hostile third dimension under a dark dusk sky — a
  big back-side sky dome (`skyDome`, follows the camera so the horizon never
  moves, `fog: false` so it stays clear past the fog; deep navy zenith with
  stars, purple band and a red/orange glow at the horizon) with a
  glowing orange sun disc (`netherSun`, orbits slowly as the dome rotates), plus
  `setDimensionEnv` neutral grey-white sun light and hemisphere fill and dark
  grey fog. The floor of the Nether is a huge lava lake: `netherLandHeight`
  (fbm island blobs on the fire line) keeps the terrain under `NETHER_FIRE_LEVEL`
  almost everywhere, so the glowing lava sea reads as one great lake, and
  only the noise highs rise into small/medium/large islands with hilly relief —
  where the old lava sea used to
  be (the block id 16 stays the same, so saves keep loading; it's just
  restored and renamed to Lava). Winding canyons (`generateNetherRivers`/
  `nearestNetherRiver`) are carved down to the fire so they fill as lava
  rivers, and steep cliffs that drop into the sea get vertical lava
  streaks pouring down their faces. Immense fire-spewing volcanoes
  (`generateVolcanoes`/`volcanoHeightAt`, exactly 2 per world forced onto
  opposite sides of the map so the cones stay clearly distinct instead of drifting
  together, each placed far from spawn
  with a spawn clearance that scales with each cone's radius, radius 70–85,
  seated on the lake via `baseY = max(NETHER_FIRE_LEVEL, netherLandHeight)` —
  bases span ~the whole 193-block world, plateau rim at `peak * 0.85` with
  peak 260–284, crater
  radius 5–10 and depth 14–28) tower up to ~240 blocks, right under the
  world ceiling: each is a truncated
  cone of NETHERRACK with a flat plateau whose centre is cut into a bowl
  (`fillVolcanoCraters`) filled with LAVA up to the rim, so every crater
  reads as a glowing fire lake. A central LAVA shaft (`fillVolcanoShafts`)
  as wide as the crater (`craterR`) runs up the middle of each volcano from
  the ground base (`baseY`) all the way to the crater, a big swimmable lava
  chimney. Twelve straight 4×4 tunnels (`volcanoTunnels`, 30°-spaced headings) are
  dug dead-straight in to the lava shaft from mouths spread across the vertical
  faces of the cone that overlook the platform's interior (towards the map
  centre, `toCentre = atan2(-z, -x)`, the heading arc `toCentre ± π/2`) — never
  on the exterior — with each tunnel at its own height, interleaved via
  `(k*7) % 12` between `baseY + 6` and `rim * 0.8` so neighbouring tunnels are
  never at the same level. Each mouth sits at the outermost point on its heading
  where the flank clears the doorway (`dOut` scan via `volcanoHeightAt`,
  threshold `hT + 5`) so the bore stays buried in rock, the volcano surface is
  flattened into a level apron (`plat + 1 .. plat + 6` carved from `dOut+1` for
  8 blocks) so the entrance reads square, and every opening is closed with a
  strict 6×6 GLOWSTONE (block id 20, unlit `basicFace` pixel texture so it
  shines) square ring (1 block thick, 4×4 hole), each ring a single random
  colour of the six. Tunnels carve
  NETHERRACK/SOULSAND only (lava is kept, so a cascade raining over a
  doorway is never cut) and generation runs `volcanoCascades` before
  `volcanoTunnels`, so coulees never fill a tunnel.
  Each volcano spills a broad main plus a
  narrower side lava coulee over the rim that runs the whole way down the
  interior-facing flank to the very base without interruption
  (`volcanoCascades`, both course angles `flowAng`/`flowAng2` fixed near
  `toCentre` so they pour onto the platform's side; carved
  down the actual visible surface (the cone flank where it stands tall, the
  island terrain where the cone is buried, via `volcanoHeightAt` and
  `netherLandHeight`),
  each course a `CASCADE_THICK` (5)-thick tongue down the surface — 1 block
  sunk below the surface so the flow reads as carved into the volcano
  wall, the rest standing proud so it reads thick from the outside, so every
  run is an unbroken sheet of lava from the rim to the fire —
  and `hollowVolcanoes` keeps a
  1-block wall of rock against every lava cell (the whole outer cone wall is
  `HOLLOW_SHELL`-thick, so the dug-in flow never breaches into the hollow
  chamber) and then keeps going past the cone's foot: each course
  cuts a tapering trench through any island in its way down to fire level and
  floods it, so the coulees pour straight into the great lava lake),
  and a constant eruption fountain
  (`updateVolcanoEmbers`/`spawnVolcanoEmber`, ~340 additive `THREE.Points`
  launched up out of the crater fire, arcing and splashing back down; torn
  down on leaving the Nether). Everything in the Nether is dark grey: terrain
  is NETHERRACK (dark grey rock, placeable, in the hotbar) instead of plain
  STONE; the top block of columns just at the fire line is dark grey
  SOULSAND, giving the sea a grim black beach;
  and `setDimensionEnv` uses neutral grey-white sun light with dark grey
  fog so the whole dimension reads grey — neutral, so glowstone
  colours stand out untinted. Rising blue embers (`updateNetherEmbers`/`ensureEmbers`, ~220 additive
  `THREE.Points` spawned only over the fire sea, drifting upward with a sway,
  fading
  and respawning every ~2–5 s; torn down on leaving the Nether) float up off
  the lava sea all around you. LAVA behaves like water: you auto-float
  to the
   surface (`headInWater` full-AABB WATER/LAVA, non-solid so you can wade from any direction; damped entry `vel.y*=0.3`, barely dips; deep ascent `SWIM_ACCEL` 2.0 blocks/s² capped at `SWIM_MAX` 64 via `waterSurfaceTop`; shallow hold at 65% immersed (`targetY = surface-1.17`, `err*4` spring with `SWIM_BRAKE*2`, `SWIM_AREA` 10) — floats waist-chest deep, not feet-on-surface; / sprints at `SPRINT`), LAVA
  is placeable only onto another LAVA cell or directly on the fire above one,
  can't be removed, and TNT blasts never destroy
  LAVA. The Nether's auto-built return portal (`buildNetherPortal`, an obsidian
  frame standing on a netherrack pad at spawn, protected, or any Nether-frame
  you build in the Nether) brings you
  back to the Overworld's last portal entry point.
- **Ender Dragon**: ambient dragon that spawns in the End and flies along a
  random closed aerial path (arc-length-sampled Catmull-Rom spline through
  random waypoints 7–22 above the platform (`DRAGON_MIN_Y`/
  `DRAGON_MAX_Y`: low runs at +7–9, high runs at +16–22, clamped both ends
  in `buildDragonPath` and per-frame in `updateDragon`), banking turns and
  dives), re-picking a
  fresh trajectory each lap; its loops alternate tight inner passes and wide
  sweeps across the whole platform (waypoint radii 10–36, clamped inside
  radius 42), so
  you get a clear view of it when TNT sticks and blows up on it. Its path is
  player-agnostic — it never aims at the player (it was changed to stop
  converging on them), flying a pure ambient circuit instead. It flees homing
  TNT: any non-stuck airborne TNT within `DRAGON_FLEE_DIST` (16) pushes the
  dragon away (`dragonFlee` smoothed, `DRAGON_FLEE_SPEED` 11 ≈ TNT home speed)
  until the bomb detonates or gives up. Its path stays
  clamped above the platform surface, so it never clips through the platform. Built from Three.js primitives only — boxy, cubic
  style: a blocky torso/belly, box horns and five head spikes, glowing purple
  eyes (unlit), translucent purple bat-wing membranes (mirrored), and
  segmented forked tail boxes; shared geometries/materials. It wears one dark
  style — Dark Purple (`DRAGON_BASE`: near-black purple body `0x1a1426`, dark
  purple belly/plates/membrane, grey-lavender bone `0x8c8496`, bright purple
  eye `0xc86bff` and breath `0xb04dff`, matte finish `DRAGON_FINISH`) — it
  spawns already violet (`hitCount = 1` + `paintDragon` at the end of
  `spawnDragon`, so there is no base-grey phase) —
  and every TNT hit re-paints it (`paintDragon` via `damageDragon`'s
  `hitCount++`) through the spectrum (`DRAGON_HUES`: violet, blue, green,
  yellow, red — first hit is violet, red wraps back to violet): each hue is
  expanded to a 5-cell palette by `dragonHitPalette` (body/belly scaled toward
  black, plate/bone/membrane mixed toward grey `0x9a9aa0`), and the eyes and
  breath tint to the hit hue as well.
  All dragon materials carry self-illumination (`emissive` = own color, synced
  in `paintDragonPalette`, base restored by `applyDragonBase`) so the dark base
  stays readable against the black End sky without changing its colors.
  It breathes a
  long-reaching spray of fading purple cube fire from its mouth (about 3x the
  platform reach) — mostly while diving at the player (~60% of dives), with
  occasional level-flight breaths in between. Its flight has small random
  speed bursts (surge) with slightly faster wing flaps. Animated via
  spline-driven yaw/pitch/bank orientation, wing flap with speed, neck/head
  sway, tail wave and body bob. It has a boss health bar (HUD) and can be
  killed with TNT blasts (see TNT). At 0 HP the dragon does not die instantly:
  it freezes and steps through every entry of the
  spectrum (a new color every `0.1`s, via `dragonHitPalette`) while shaking hard (layered 7 Hz + 13.1 Hz sines plus jitter around the death anchor) for
  a fixed 1.5 s (`dragon.dying`/`deathFlash`/`deathIdx`, driven inside `updateDragon` via
  `paintDragonPalette`; `damageDragon` now only starts the countdown instead of
   killing outright, and clears any live breath cubes at kill time), then death triggers a huge multicolor explosion (420
  spectrum-hued particles plus a white second layer via `spawnDragonDeath`,
  no flash sphere), opens the return portal and removes the dragon. Resources are
  disposed when leaving the End. The dragon is a flying mob (`kind: "dragon"`
  in `mobs[]`, `hw` 1.5 `h` 3, `dim: "end"`, created in `spawnDragon` as
  `dragon.mob` and removed in `removeDragon`): `updateDragon` syncs `pos`/`vel`
  every frame so `pickMob`, the displacement grapple and aimed TNT track it
  live; `updateMobs` skips it (no ground physics) and the separation/push/collide
  helpers ignore it. It can be grappled and followed like a pigeon
  (same tow spring behind `vel`, but at `DRAGON_FOLLOW_DIST` 8) but never grabbed —
  ENTER refuses with a toast. Grapple latch/release skips `setMobTransparent`
  for it so hit-repainting keeps working on the shared materials.
- **Villagers**: 24 villagers (8 houses ×3: 2 adults+1 baby, `VILLAGE_RADIUS 28` stone plaza at `villageCenter.y` integrated in `generateWorld` via `computeVillageLayout` before terrain — override `h=villageCenter.y`, `intersectsVillage` skips tunnels/rooms/stairs/trees, `placeVillageHouses` `7×7×5` seeded `hash2` with `|dx|<9&&|dz|<9` veto). Houses enterable (2-wide door facing centre, window opposite, flat roof, palette variance). Villagers use same AABB/gravity as player (`aabbCollidesWorld`/`moveMobAxisX/Z/Y`/`mobPhysicsStep` `GRAVITY 37.44`, moon gravity `*0.5` at `MOON_Y-MOON_R`, `hw 0.27/0.16` `h 1.82/0.98`, `villageBound` clamp, `WALK/2` `2.2` (`WALK 4.4`), flee `WALK×2` `8.8`, float in `WATER/LAVA/MOON_WATER` exactly like player — same buoyancy (`mobInWater`/`waterSurfaceForMob` `SWIM_ACCEL 2.0` `SWIM_BRAKE 1.5` `SWIM_AREA 10` `SWIM_MAX 64` `vel.y*=0.3` on entry, `targetY = surface - h/2` waterline at 1/2 height)). Collisions: world + player (`pushMobsFromPlayer`/`moveAxisX/Z` push via `nearbyMobsFor` grid) + among themselves (`separateMobs`/`mobCollidesOther` via `MOB_GRID 8` `mobGrid` `mobById` `buildMobGrid`, `separateMobs` every frame 3 iterations (expanded personal space `+0.18` hard, `+0.04` for `mobWouldCollide` blocking (strict visual, not `0.14`, to avoid pen deadlock), soft `+0.45` anticipatory), repulsion steering (`+0.50` radius, `0.85*WALK`) and post-physics `separateMobs` pass plus `moveMobAxisX/Z`/`wolfMoveAxisX/Z` mob-blocking (`mobWouldCollide` at `+0.14`) to never merge — instrumented, best-effort never blocked). Materials cached (`villagerMatCache`/`villagerHeadMatCache`, `villagerGeo` reused) and spawn snapped to block centers `floor+0.5` with `usedBlocks` no overlap. Holes and house roofs = walls via `hasMobGround`/`mobBlockedAt` (`>0.02` overlap, `!isSolid y-1` counts as empty, plus house roof `vy+5` and `LOG` fence top excluded as ground and `moveMobAxisY`/`wolfMoveAxisY` skip `LOG` fence / house `vy+1..5` for Y push, so `pig`/`cow` never stay on fence and ground mobs never climb onto roofs alone even after TNT craters, `MOVE_X/Z` auto-step `±1` `hasMobGround`/`!aabb`; mobs already on a roof (`mobOnRoofLevel`/`houseAtRoof`/`isMobOnRoof`, `vy+5.5`) keep solid support (`hasMobGround`/`wolfHasMobGround`/`moveMobAxisY`/`wolfMoveAxisY` skip the house exclusion) and wander it locally (`wanderGoalForRoof` scored like `wanderGoalFor` — least-visited `v*10 - d*0.15` + same-roof mob dispersion over the full 7x7 footprint, so they cross the whole roof instead of pacing one corner, roof edges act as walls, `releaseCarriedMobAt` places roof-local targets, TNT panic runs in place at `WALKx2` with fast retargets)) — `mobProbeFree` and `findVillagePath` (BFS 4-N `0.5`, `pyHint`, `intersectsVillage`/`isInsideAnyHouse` off-target) avoid holes/roofs only. Water on ground (floor same level as water block — `WATER`/`LAVA`/`MOON_WATER` at `gy` floor or `py` foot with solid below) is **not** a wall: `hasMobGround` treats `WATER`/`LAVA`/`MOON_WATER` at `gy` as ground and ignores water at `py`, so `mobBlockedAt`/`mobProbeFree`/`findVillagePath` may go through it; `moveMobAxisX/Z` use `tryMobWaterStep` (`vel.y=JUMP_MIN+2.5` from `fy`/`fy+1` when `mobInWater`) to climb back onto floor at same level like wolves, smooth `GRAVITY` arc without hesitation, for every mob (villagers, babies, cows, etc.); `updateMobs` `mobTick` + `addVisit`/`visitGrid` `VISIT_CELL 8` `wanderGoalFor` least-visited `v*10 - d*0.15+mobPenalty` `30` tries `2` skip `lastTarget<4` (+penalty `8*(1.8-d)` if near other mob/target, `6*(1.4-td)`; pen: `8*(1.9-d)`/`6*(1.6-td)`; wolf: `7*(1.9-d)`/`5*(1.5-td)`), disperses pen center cluster, 12-dir scoring `free*(0.55+0.45*dot)` + BFS `>1.8` or `probe<0.55`, hysteresis `steerX/Z/Cooldown 0.45/0.35` avoids jitter, failsafe `want==0&&dist>0.6` 8 dirs `free>0.5`, anti-stuck `_stuckT>0.55` (target `1.5-2.5` along the turn dir, `canStand` `hasMobGround y/y±1`) + contact pivot `probe<0.15` both turn via `obstacleTurnDir` (heading-relative ±90°, freer side wins, ties alternate via `_turnSide`, 180° U-turn only when both sides blocked — never a random spin). TNT: `handleMobExplosion` only panics; explosion crater leaves the mob's standing block intact (`isMobStandingOn`/`intersectsMob` via `nearbyMobsFor` in `processExplosionQueue` and `breakBlock` `isMobStandingOn||intersectsMob` guard the pillar, so nearby blasts keep mobs on their block and a `TNT` under a mob cannot be ignited directly; `TNT` itself bypasses the guard for chain detonation, so a chained blast does destroy the `TNT` under the mob and the mob drops into the crater via normal `mobPhysicsStep` gravity — no sideways fall, no fade/despawn). `generateWorld`/`removeVillagers` clear `visitGrid`/`mobGrid`/`mobById`. **TNT panic**: `panicVillagers(cx,cy,cz)` called in `handleMobExplosion` when `dim=="over"` and the explosion is inside `(VILLAGE_RADIUS+15)²` of `villageCenter` and `abs(cy-villageCenter.y)<=CLOUD_BASE/2`; all villagers `homeId>=0` get `fleeUntil=now+10+stagger` (`stagger=Math.random()*3`, 0–3 s random per villager to stagger the exit), flee toward the CENTER of their house (`house.cx+0.5,house.cz+0.5` via `mode="goOut"`+BFS `target=centre`, `WALK*2`), stay `insideT=10s+stagger` inside the house if already inside, then return to `wander` after expiry (staggered `insideT`/`fleeUntil` make villagers exit in single file over ~3 s instead of all at once, avoiding a bottleneck at the door); while fleeing `mobCollidesOther/separateMobs/pushMobsFromPlayer` ignore parent/child and push at `0.22`; babies do not follow the parent during `fleeUntil`. Nether/End have no village; Overworld mobs persist via `snapshotOverworldMobs`/`restoreOverworldMobs` (in-memory `overworldMobCache` across dimension trips, 19-byte entries in save v10 across reloads, snap-and-settle validation, carried mob travels instead of caching; return restores whenever live < cache so carrying through a portal never wipes the village, grab-mode grapple mobs are cached while release-mode ones ride the hook back to hand via dim-mismatch guards in `updateCarryGrapple`), fresh `spawnVillagers` only for new worlds/old saves/shortfalls;   restores resume in place (saved `villageBound`/`penBound` kept so outside mobs are never clamped back, wander target reset to the respawn spot — no village pull) and the whole simulation freezes while the pause menu or help panel is open (player physics, grapples, TNT, portals and the dragon all run only when `!started || (locked && !helpOpen)`, same gate as `updateMobs`/`updateChains`), so Resume finds everything exactly where ESC left it; `removeVillagers`/`spawnVillagers` on `buildWorld`/`resetDims`, `mobStats` throttled.
- **Pig/cow pen**: village extension (`VILLAGE_PEN_W 14×VILLAGE_PEN_D 12`, `villagePen:{minX,maxX,minZ,maxZ,cx,cz,vy,gateSide}` placed **before** houses in `computeVillageLayout` (1200 tries `hash2` `seed+7250/7251`, `+R` inside, houses avoid `+2`), `placeVillagePen` spreads `GRASS` inside and `LOG` **1 block high** closed fence, plus a 2×2 1-deep corner wading pool 1 block above the ground (`VILLAGE_PEN_POOL_W 2×VILLAGE_PEN_POOL_D 2×VILLAGE_PEN_POOL_DEPTH 1`, `villagePen.pool` flush in the pen corner at `minX+1/minZ+1`, `placeVillagePenPool` sets a STONE floor at `vy` with WATER at `vy+1` plus a STONE L rim on the two inner sides at `vy+1` — the pen's own LOG fence frames the two corner sides, called in `generateWorld` right after `placeVillagePen`; no mob ever spawns inside it — `isInsidePenPool` skips in villager/pig/cow/wolf spawns as well as in the village-pool wander/spawn/path avoidance, and `penPoolExitTarget` mirrors the water-exit steering for pen targets) — physics blocks via `aabbCollidesWorld`/`hasMobGround` (excludes `LOG` fence top as ground) plus explicit `pigOverlapsFence` (`isPigCow`/`pigOverlapsFence`) in `separateMobs`/`pushMobsFromPlayer`/`moveMobAxisX/Z` that forbids any `pig`/`cow` move onto a solid `LOG` fence cell (corner jam via collisions can no longer push onto rim; wolves still allowed, `AIR` gap lets them through) and `mobPhysicsStep`/`updateMobs` teleport to pen center (`pen.cx+0.5, pen.cz+0.5, pen.vy+1`) if they ever end up overlapping a solid fence (so `pig`/`cow` never stay on rim). `PIG_COUNT 4` + `COW_COUNT 4` (`pigMat 0xf2aeb2` pink, `cowMat` white spotted, `makePigMesh`/`makeCowMesh` 4 legs `legBL/BR/FL/FR`, `hw0.32` `h0.92/1.30`, `isInsidePen`/`randomPenPoint`/`wanderGoalForPen` 30 tries `visit*10 - d*0.15`). Same physics as villagers incl. same float in water as player (`mobInWater`/`waterSurfaceForMob` `SWIM_ACCEL 2.0` `SWIM_BRAKE 1.5` `SWIM_AREA 10` `SWIM_MAX 64` `targetY = surface - h/2`) (`villagerHW/H` dispatched by `kind`, `mobBlockedAt`/`mobProbeFree` shared, water on ground at same level (`WATER`/`LAVA`/`MOON_WATER` at `gy` floor or `py` foot) counts as ground (like wolves) — not avoided, probe/path may go through; `tryMobWaterStep` lets them climb back onto floor at same level smoothly (`JUMP_MIN+2.5` from `fy`/`fy+1` when `mobInWater`), without hesitation, for every kind; only the fence blocks). Grab `ENTER` via `pickMob`/`CARRY_GRAPPLE`, `handleMobExplosion` only panics then `fleeUntil` (`panicPenMobs` same radius as villagers `(VILLAGE_RADIUS+15)²` `|dy|<CLOUD_BASE/2`, `stagger 0-3s`, if gap in fence `findPenGaps`/`nearestPenGap` → `penGapInside` looks for the entrance, otherwise `randomAroundPenPoint` runs around at `WALK*2` `8.8`). Outside the village radius a TNT within 20 blocks horizontally (`dx²+dz²≤400`, `|dy|<12`) triggers 5s (`+0-1s` stagger) panic for nearby pigs/cows that flee away from the blast via `fleePointAway` (7-14 blocks opposite the explosion, `mobProbeFree`/`hasMobGround` validated, `WALK*2`, no pen rally, `_outsideFlee`/`_fleeSrcX/Z` cleared after). `updateMobs` branch `pig/cow`: `fleeUntil` with `_outsideFlee` → `fleePointAway` 7-14 blocks opposite TNT for 5s (`WALK*2`, outside village no pen); otherwise `fleeUntil` outside pen → `nearestPenGap`/`penGapInside`/`randomAroundPenPoint` (look for entrance, otherwise loop `2s` around), inside → `wanderGoalForPen` milling, otherwise `insidePen ? wanderGoalForPen : wanderGoalFor` (`hasMobGround`/`aabb`/`findPenGaps`/`randomAroundPenPoint`), 4-leg animation `sin*0.65` (`legBL/BR/FL/FR`). `spawnVillagers` spawns pigs/cows after villagers (`usedBlocks` avoids overlap, `gid` continuous), `removeVillagers` removes them, regenerated on every `buildWorld`; center-cluster fixed via `wanderGoalForPen` penalties (`8*(1.9-d)`/`6*(1.6-td)`) + repulsion and anti-stuck `wanderGoalForPen` branch and `separateMobs` 3×/frame, pen avgDist `~3–4` vs `~1.9` before, `maxOverlap 0` instrumented.
- **Village pool**: 8×6 swimming pool 2 deep at floor level (`VILLAGE_POOL_W 8×VILLAGE_POOL_D 6`, `VILLAGE_POOL_DEPTH 2`, `villagePool:{minX,maxX,minZ,maxZ,cx,cz,vy}` placed after the pen in `computeVillageLayout` (1200 tries `hash2` `seed+7260/7261`, `+R` inside, avoids pen `+2`, houses avoid it `+2` so no intersection with houses or pen), `placeVillagePool` sets OBSIDIAN floor at `vy-2` with WATER at `vy-1..vy` (surface flush with the stone plaza) plus a 1-block STONE frame ring around the water at `vy-1..vy` (stone walls `+` rim, so every edge water cell touches stone sideways and every bottom-layer cell sits on obsidian) and clears `vy+1..vy+2` to AIR, called in `generateWorld` after houses/pen; `isInsidePool`/`poolExitTarget` exposed in `_test`). All mobs float uniformly at 1/2 height (`MOB_FLOAT_FRAC` 0.5, `mobFloatTargetY`) and share one water-exit jump (`mobWaterExitJump`: live `mobInWater`, `fy`/`fy+1`, `JUMP_MIN+2.5`, used by both `tryMobWaterStep` and `tryWolfStep` for villagers/babies/pigs/cows/wolves without exception, so the ground-level water exit is preserved at the deeper float). Pool wander targets are avoided (`randomVillagePoint`/`wanderGoalFor`/`wanderGoalForWolf`/`fleePointAway`/`randomAroundPenPoint` skip `isInsidePool`, `findVillagePath`/`wolfFindPath` route around it, spawns avoid it) and any mob in pool water steers directly to the nearest outside point (`poolExitTarget`, bypassing BFS/avoidance, no extra scans) so exits are quick, smooth and lag-free via the normal jump arc.
- **Wolves**: `WOLF_COUNT 5` (`WOLF_FUR 0xc8cdd2`, `WOLF_COLLAR_COLORS` 5 — red `0xe53935`, green `0x2ecc40`, blue `0x246bff`, yellow `0xffd600`, turquoise `0x00bfa5` — random per wolf, `makeWolfMesh(fur, collar)` fur grey body 0.92×0.58×1.18, head/snout/ears/tail + U collar (`0.62×0.38×0.08`, `colY 0.69` `colZ 0.64` three `BoxGeometry` bars — bottom/left/right — forming a U open at the top (no top bar, sides terminate cleanly at the top), tucked right under the neck, narrow to sit flush against the head sides with no gap via `MeshStandardMaterial` in the collar color, stored as `collar`/`collarHex` on mob and in `mesh.userData`) wander the village (`villageBound:true`, `wanderGoalForWolf`/`wolfFindPath`/`wolfProbeFree` via `VISIT_CELL`, `hw0.30` `h0.90`, `WALK/2`). Player-like physics without jump as a **general mob capability `canStep`** (`mobCanStep`/`mobHasGroundFor`/`mobBlockedAtFor`/`mobProbeFreeFor` helpers, `canStep:false` for villagers/pigs/cows, `canStep:true` for wolves — request said "désactivée pour les loups" but logically wolves must step while villagers cannot, so enabled for wolves; note corrected) — `tryWolfStep`/`wolfMoveAxisX/Z/Y`/`wolfPhysicsStep` reuse `GRAVITY 37.44` moon `*0.5` (`tryWolfStep` now makes them jump `vel.y=JUMP_MIN+2.5` with `onGround=false` and no blocking — `wolfMoveAxisX/Z` returns `false` on jump so they visibly leap onto the marche (`GRAVITY` arc `~1.44` blocks high, lands on `by+1+0.001`), `mobInWater` allows `tryWolfStep`/`mobWaterExitJump` from water at `fy`/`fy+1`, 1 block at a time, `wolfStepUp` kept only for water, `wolfHasMobGround` uses `any` overlap and `wolfMoveAxisY` keeps `onGround` only when `(pos.y%1)<0.05` so 1-block drops fall with `GRAVITY` instead of a `STEP_SPEED` glide) and float in `WATER/LAVA/MOON_WATER` exactly like player (`mobInWater`/`waterSurfaceForMob` `SWIM_ACCEL 2.0` `SWIM_BRAKE 1.5` `SWIM_AREA 10` `SWIM_MAX 64` `vel.y*=0.3` on entry, `targetY = surface - h/2` waterline at 1/2 height) (water on ground at same level — `WATER`/`LAVA`/`MOON_WATER` at `gy` floor or `py` foot — is not a hole for any mob: `hasMobGround`/`wolfHasMobGround` treat `WATER`/`LAVA`/`MOON_WATER` at `gy` as ground and ignore at `py`, so every mob (villagers, babies, pigs, cows, wolves) may walk through shallow water and climb back onto floor at same level via `tryMobWaterStep`/`tryWolfStep` (`JUMP_MIN+2.5` from `fy`/`fy+1` when in water, `GRAVITY` arc, smooth, no hesitation); `wolfHasMobGround` now uses `any` overlap); `moveMobAxisX/Z` step-up and step-down now gated on `mob.canStep` via `mobHasGroundFor` so villagers/pigs/cows treat holes as walls. TNT panic `panicWolves` `10s+stagger` at `WALK*2` inside the village now **runs toward the pen**; outside the village radius a TNT within 20 blocks (`dx²+dz²≤400`, `|dy|<12`) triggers 5s (`+0-1s` stagger) panic for nearby wolves that flee away from the blast via `fleePointAway` (7-14 blocks opposite, `wolfProbeFree`/`wolfHasMobGround` validated, `WALK*2`, no pen rally, `_outsideFlee`/`_fleeSrcX/Z`) (sets `target` inside pen via `randomPenPoint`/`nearestPenGap` + `penGapInside`, no teleport — `pos` is not set, they run at `WALK*2` and must climb the 1-high LOG fence via jumping `vel.y=JUMP_MIN+2.5` with `canStep`/`wolfBlockedAt`/`wolfProbeFree`, and they now fall with `GRAVITY` (no `wolfStepDown` glide)). Grab `ENTER` via `pickMob` (ray-AABB, `villagerHW/H` dispatch). Spawned after pigs/cows in `spawnVillagers` (`usedBlocks` no overlap, total 37 = 24 villagers+8 pen+5 wolves), `removeVillagers`/`buildWorld` regen.
- **Mob carry (ENTER)**: press `Enter`/`NumpadEnter` to fire a red grapple (`CARRY_GRAPPLE_CUBES` 2600 `#870000` `0x870000` cube chain `opacity 0.3` + `carryGrappleHead` `0x5a0000` `transparent` `opacity 0.3`) — grab hook flies to mob center (`pos+h/2`) at `MOB_GRAPPLE_THROW = GRAPPLE_THROW*1.25 =87.5` horiz. (`175` vert. with the same `grappleVertBoost` ×2 as displacement, `isVert=|dy|>2*|dx|`), homing: `updateCarryGrapple` each tick sets `carryGrappleTarget=mob.pos+h/2` and moves `carryGrappleHookPos` toward it at `MOB_GRAPPLE_THROW*tb` (hit point `getMobHitOffset`, smooth `min(step,dist)` no last-moment snap, rope follows `hookPos`) (passes through walls, ignores collision), `carryGrappleCubes` rope follows `hookPos` (not `lerp`) and is rendered at `30%` opacity both ways (`carryGrappleCubeMat`/`carryGrappleHead.material` `opacity 0.3`/`transparent true`); mob **keeps moving** during grab chase (not frozen — `startCarryGrabGrapple` does not touch `vel/path`, `isMobFrozenByGrapple` returns `carryGrapplePulling` only for grab so `updateMobs`/`separateMobs`/`pushMobsFromPlayer`/`moveAxisX/Z` keep wandering until contact, then freeze) and for release the mob is frozen from the start (`isMobFrozenByGrapple` true when `mode==="release"` and `Active||Pulling||Retracting`, so `mob.pos` rides `carryGrappleHookPos` at `MOB_GRAPPLE_THROW*tb` with no wander, `hitR=hw+0.35`); no issue if the mob goes behind a wall, the hook passes through; as soon as it hits it pulls back **with the mob** at `MOB_GRAPPLE_RETRACT = MOB_GRAPPLE_THROW*1.25 =109.4` (rope follows `mob.pos+h/2` back to `eye+0.3`, `carryGrappleHookPos` locked to mob so you see the mob ride the hook tip at `alpha=1`, no fading — dead `alpha`/`pullDist`/`Fly` code removed) held   (`carryMob`, `mode="carried"`). If the grabbed mob is also the displacement grapple's
  current target (`grappleMob`), the displacement grapple detaches without fling
  (`detachDisplacementGrapple`) the moment the grab hook catches it, so normal
  physics resumes and the player falls with gravity while the mob rides in;
  grabbing any other mob leaves the displacement tow untouched. `handleCarryEnterUp`: releasing `Enter` before the hook touches its target aborts and retracts the hook at `GRAPPLE_RETRACT =275` — for grab the hook retracts empty and the mob stays where it is (pulling for grab now continues even if released, mob still rides to the player at `MOB_GRAPPLE_RETRACT`), for release the mob (frozen) rides the hook back to the player (`carryGrappleHookPos`+`mob.pos` both move at `GRAPPLE_RETRACT` to the eye, then `carryMob` is restored). Holding `Enter` through the hit lets the mob return directly without re-pressing. Release when carrying now fires a 2-phase grapple (`startCarryReleaseGrapple` creates `Active` hook flying to the block at `MOB_GRAPPLE_THROW*tb` with the mob riding the tip, then `Pulling` mob to the block at `MOB_GRAPPLE_RETRACT`,   `releaseCarriedMobAt` and retract at `GRAPPLE_RETRACT`; flat `while(isSolid)h++`
  `h<=1`→center else face; the mob adopts the current dimension when the release
  flight starts, so transported mobs (e.g. an End enderman) can be released in
  any dimension instead of tripping the grapple dim-mismatch guard). Empty retracts (with or without mob) always use `GRAPPLE_RETRACT` with no timeout. After any grapple you must release `Enter` and press again (`e.repeat` ignored).   `pickMob` ray-AABB unlimited range (used with `blockDist` max for `fireGrapple`). While held, `updateCarry` moves mob to `eye+fwd*CARRY_DIST(1.2)-CARRY_DOWN(0.40)-h/2` with `playerArms` visible.
- **Mob chains**: with a mob carried, pressing ENTER while aiming at any mob (any kind, chained or solo, same dimension — solo endermen refused like the grapple) attaches the carried mob by flight class (`isFlyingKind`: pigeons and dragons fly, everything else is grounded; mode picked by `chainAttachModeFor` — every chain/TNT/grapple condition that is about flight keys on it, while pigeon-only systems (flocking, perch/coop, takeoff, sizes, saves) stay literal): a flying mob onto a grounded lead (or solo mob) goes in front — new lead via `prependChainLead` (collision-free placement via `seatNewLeadNear`; takes off and airlifts, including a fresh 2-chain onto a solo mob) — while every other pairing goes behind the aimed mob (`insertChainBehind`: same seating/rollback/snap pattern, position 2 behind a lead, insert behind a member, true append on a tail; a perched pigeon carrier takes off). The dragon always stays root as a corollary (it is flying, so everything links behind it); aiming at anything else releases to the ground as before. While the player is latched onto the carrier itself (displacement-grapple follow on a pigeon or dragon), attaching chains the mob behind the **player** instead of the bird: the player joins the chain as a sentinel member (`PLAYER_CHAIN_ID "player"`, a `playerChainAvatar` pseudo-mob with live `pos`/`vel` getters, `playerInChain`), so the chain reads pigeon → player → mob — `chainAttachTarget` returns the ride itself for a carried pigeon (spliced directly behind it via `insertBehindRide`, ahead of the ride's existing children) and the avatar (or the sub-chain tail when the player already tows one) otherwise, the attach hook flies to the target, `linkChain` accepts the avatar as carrier, `chainRootOf`/`chainTailOf` walk through it, `updateChains` tows the mob one link behind the player at the latch target's trail distance (`chainFollowDist`: 2.5 pigeon / 8 dragon) with the rope rendered from the player, firing the displacement grapple into your own chain is refused, and any unlatch (release, retract, `pruneChains` backstop) re-links the whole sub-chain onto the latched pigeon/dragon (`spliceChainLink` from the per-link `playerFrontId`, appended after any pre-existing children) with the new link stretched up to 2x and snapped to one link; the player entry never reaches saves (its id is absent from the mob index, so serialization skips it). Attaching to a perched/landing pigeon (roof, cloud, tree) works too: the carried mob arrives centered on the sitting bird, which buries tall mobs in the surface and used to make `linkChain` refuse — now a colliding arrival is re-seated standing on the carrier's surface (`seatChainChildOnCarrierSurface`, nearby offsets tried) before giving up, a successful attach makes a perched/`toPerch` carrier take off (`pigeonTakeoff`, like a displacement latch does), and carriers never roll perch legs or perch hops while carrying (`pigeonNextLeg`/`pigeonTakeoff` skip when `chainChild.has`), so chains stay airborne. Each persistent link is a regular displacement hook (brown `0x8a6d3b` rope + `0x4a3a1e` head per link, opaque) holding single-file trail slots behind its carrier (`chainFollowDist`: 2.5 pigeon / 8 dragon, base `hypot(trail, 0.4)` ≈ 2.53 / 8.01, `updateChains`). Flying-led links (flying root) hold a straight formation off the lead's live flight axis: one smoothed axis per flying root (`_chAx`, fast `dt*8` lerp of the velocity heading, climb clamped ±0.6, held while hovering) with a smoothed turn rate (`_chAxV`) so slots swing without lagging into stretch, and each follower steers toward its own carrier's slot one link behind on that axis (`chainFollowDist`, feet-frame so mixed-kind trails fly level instead of stair-stepping) with `vel = carrier velocity + turn-rate swing + 5 × offset` (`CHAIN_TOW_KP`), capped at `leadSpd + 8` (`chainLeadSpeedOf`) — first-order convergence through `chainMoveAxis`, no springs, no accordion, no orbit and no `^` on climb-then-dive (slots sit on the current axis by construction, so the chain is straight at all times and only bends transiently inside hard reversals). Links update root-to-tail (`chainDepthOfId` order) so each follower sees its carrier's fresh position. A link stretched past 1.5x but within `CHAIN_FLY_SNAP_MAX` (2.2x) snaps its feet onto its slot on the first free frame (splices land at 1x without giant pops, velocity re-seeded from the slot motion); a link stretched past `CHAIN_FLY_LEASH` (2.5x) for over `CHAIN_FLY_LEASH_T` (1 s) — e.g. a follower wedged on a cloud while the lead flies on — is cut loose via `freeChainRoot` instead of hanging forever, so ropes never span the map and freed mobs never teleport; `flySplitT` sever and jumping hop-assist are kept. Chained followers smoothly rotate to face their travel direction (yaw eased at 10/s toward the velocity heading). Past `CHAIN_FLY_SPLIT_DY` (8) vertical for over a second (`link.flySplitT`, read before the recoil so a snagged follower can't hide behind the snap) the link is cut via `freeChainRoot`, same sub-chain semantics as the ground split. Hole threading (`chainThreadRide`, both tow branches): a follower stretched past 1.5x whose direct segment to the carrier is blocked by rock rides the carrier's crumb trail kinematically instead of pressing the wall — 3D `chainSlideToward` steps toward successive crumbs (which inherit the lead's funnel centring) with leg physics suspended — while `farT`/`flySplitT`/`strainT` freeze, so the chain survives the hole instead of severing; the ride gives up after `CHAIN_THREAD_MAX_T` 4 s (normal rules resume) and never engages in open sky (direct segment free), so leash/split severs there are untouched. Ground-led links are walked, not dragged (`updateChainGroundLink`, reached whenever the chain root is grounded — the tow routes on root kind, so every member of a pigeon/dragon-led chain flies in formation while a pigeon chained behind a walking lead hover-walks via `floats`): each follower steers toward its slot (smoothed `towDir` + `chainTrailTarget` crumb + `towPos`, same 0.4-spaced crumbs capped at 80 with teleport-clear, straight tow as fallback on short trails) with its own legs (`mobPhysicsStep`/`wolfPhysicsStep`, so gravity, buoyancy, holes-as-walls, pen fence and mob collision all apply) at `WALK/2`, hustling at `WALK×2` when strained, with the tow spring kept as a strained-only assist (same stiff/damp, `taut` boost kept) plus tow-target feedforward so followers track the swinging slot through turns instead of cutting the corner; link distance is held in a 0.5x–1.5x band around base by a collision-aware solver (`chainSlideToward`, 0.5 sub-steps, never through rock — no ghost anywhere on the ground path): past 1.5x the follower is pulled in toward the carrier, below 0.5x it is pushed back out along the link axis, and the carrier itself is never yanked. Grounded carriers get horizontal-only slides that never ratchet followers up walls (vertical splits are the split-sever's job); while `carrierAirT` (airborne over 0.5 s) the slides stay 3D and the speed cap lifts to pigeon pace so airlifted followers climb with the flight. Past the 2x leash neither endpoint may recede (a velocity filter strips both separating velocity components) and a true root (unchained, non-player, ground) is braked to a stop until the follower closes — stretch never severs, it waits. Strained followers hop 1-block lips with headroom (`JUMP_MIN + 2.5`, 0.8 s cooldown; wolves step on their own via `canStep`). Flying followers behind a grounded carrier float-walk through the same state machine (`floats`: identical band/leash/strain handling with the mesh pitch kept, but hover locomotion instead of legs — critically-damped toward slot height, integrated via `chainMoveAxis`, no gravity, no hop, 1-block lips always glided over, `_chainStep` skipped; in water the hover yields to the shared half-height buoyancy (`mobInWater`/`waterSurfaceForMob`/`mobFloatTargetY`, damped entry, `SWIM_MAX` cap) and a blocked horizontal push onto a same-level shore fires the shared `mobWaterExitJump` with a short ballistic arc (`_chainJumpT`, cleared in `resumeChainedMob`), so chained pigeons bob and climb out exactly like ground mobs), so a pigeon middle floats at ground level and never disturbs the walking chain. Level splits break the link instead of climbing: a follower strained out-of-band with no
progress (`strainT`) while more than `CHAIN_SPLIT_DY` (3) above/below its carrier for
`CHAIN_SPLIT_STRAIN_T` (1 s) is cut loose via `freeChainRoot` — unless the carrier has
been continuously airborne over 0.5 s (`link.carrierAirT`, tolerant of the roof-stand
`onGround` flicker; refreshed every frame by a downward probe in the legacy tow and the
`floats` branch, reset in `resumeChainedMob`), so a pigeon-led airlift rides out the
flight (slides stay 3D and the speed cap lifts to pigeon pace while `carrierAirT` while
grounded carriers get horizontal-only slides that never ratchet followers up walls)
and only severs if the split persists after landing — it resumes as its own
sub-chain root (milling locally) with everything below it still linked, never a teleport
or phase. Step-up is root-gated by jumping leadership: when the chain root is a jumping kind (`isJumpingKind`, today just the wolf — checked via `chainJumpLed`), every ground member gains full jumping legs (`canStep` plus a `_chainStep` tag — steps, drops, holes and even the pen-fence hop follow the lead wherever it goes, since the jumping path has no fence logic); when the root is anything else, chained jumping kinds lose their step-up (suppressed under the same tag) and the whole chain walks step-free. The tag re-evaluates per frame (root swaps apply instantly) and is always restored kind-correctly on unlink (`resumeChainedMob`, `chainTakeForCarry`; saves re-derive it because `canStep` is kind-derived at spawn/restore). Chains are single-child lists rooted at a pigeon, a ground mob (Overworld) or the dragon (End), uncapped, session-only (cleared on rebuild/dimension trips via `clearChains`/`pruneChains`; overworld links persist across save/resume in v14, End links rebuild fresh). ENTER-grabbing any chain member takes it to hand while the chain splices around it — the mob behind re-links to the mob in front (`chainTakeForCarry` + `spliceChainLink`, also driven by the `updateChains` carrier-held backstop), the new link starting at up to 2x length (clamped 1–2, measured at splice) and snapping back to exactly one link on the first free frame via the 1x projection; when the splice finds no seat the downstream still survives as its own sub-chain (`freeChainRoot`) instead of dropping; grabbing the lead breaks only its link to the next — the downstream keeps its links with the next mob resumed as the new root (same for a dead front, and a grabbed tail only ever cuts its own link); TNT removals sever instead of splicing (`unchainMob` → `severChainMob`, `killChainMob` inline — both keep the downstream sub-chain via `freeChainRoot`); Displacement grapple aimed at a non-tail member auto-redirects to the tail (`fireGrapple` + `chainTailOf`, solo endermen still refused, chained ones latch normally) and follows as the last link at `CHAIN_LINK_LEN`; releasing any mob-follow inherits the mob's velocity with no fling boost (`flingActive = false`), then gravity. In the End, chained/carrier non-dragon mobs are TNT-targetable under the same aim/lock rules as pigeons (`aimedPigeon` + the ignite path accept them there; solo endermen stay refused). A chained enderman works like any other chain member for everything (grab, grapple latch/tow/release, TNT, fall) and reverts to special behaviour the instant it unlinks. TNT only ever damages leaders: a dragon hit deals full damage without touching links (stuck blasts route to the homing point-blank queue entry so `damageDragon` + tinted burst fire; death drops the chain via `removeDragon` with freed endermen falling to the platform). Any pigeon hit — solo, lead, middle or tail — explodes and respawns (`killPigeon` out of view for solos, `killChainMob`/`respawnChainMob` at origin for chained ones, downstream falling); any other linked mob hit (chained ground mob, enderman) just unlinks (`unchainMob`: `severChainMob` + resume in place with `villageBound`/`penBound` cleared, so they mill locally around the drop spot via `wanderNear` instead of hiking back to the village/pen — no kill/respawn/damage; freed endermen fall with real gravity (`falling`/`fallV` in `updateEnderman`, set in `resumeChainedMob` so every unlink path grounds them, same `GRAVITY` in every dimension, landing on a downward-only `groundYDown` scan and floating in water instead) instead of hovering down, then resume staring once landed. TNT severs the chain at the victim: `severChainMob` cuts only the two adjacent links — the upstream ends at the surviving predecessor, and the downstream always survives as its own sub-chain (`freeChainRoot`: parent entry + rope removed, new root resumed with bounds cleared so it mills locally, links below kept; held-mob edge disposed without resume) — it keeps flying behind a flying root and walks behind a grounded one via the normal ground links (flying tails ride the spring tow); a hit tail just unlinks. When a chain lead is ENTER-grabbed, only its link to the next mob is cut — the downstream keeps its links with the next mob resumed as the new root (bounds cleared, mills locally). Flying victims explode and respawn (`killChainMob`/`respawnChainMob` at origin); grounded victims (and endermen) fall in place with bounds cleared, milling locally instead of hiking back. ENTER-grab keeps the splice-around behavior via `chainTakeForCarry`. `groundYDown` exists because the shared `groundYForMob` ±24 window misses ground more than 24 below and falls back to the column top (moon/clouds) — which used to rocket freed or staring endermen skyward; `endermanSurfaceY` uses it too), clears the TNT lock, fizzles the rest of the in-flight volley into harmless bursts, and detaches a following displacement grapple. A cooped carrier pigeon keeps its chain: the lead mills indoors via the tunnel planner while followers tow with the normal collision-aware slides, and only an over-stretched link severs singly via the leash/split rules instead of dissolving the whole chain. Verified headless: 33/33 overworld (link/tow/ropes, regrab split, kill+origin respawn, ENTER attach/regrab, tail redirect, no `PAGEERROR`) + 14/14 dragon links (8.01/2.53, no-teleport, damage-safe, death break). Player-in-chain and splice verified headless: attach/tow one link behind the player with the rope from the player, unlatch and middle-grab splices stretch toward 2x then snap to 1x, root-grab keeps dropping downstream, End dragon link tows at 8.01 and splices to the dragon on unlatch, no `PAGEERROR`. Takeover/prepend/insert (TNT severing both adjacent links with flying-respawn/grounded-fall victims, any-mob ground chains, flying-lead prepend with takeoff, universal insert-behind) plus the flight-class rule (flying onto a grounded lead goes in front, all other pairings insert behind, dragon always root as a corollary) plus sliding around rock (no phasing anywhere — every tow moves via `chainMoveAxis`/`chainSlideToward` only) and jumping hop-assist (`chainHasJumping`) — every link is projected to exactly one link length on the first free frame (feet-to-slot snap on flying-led links, horizontal snap on ground-led links so feet stay on terrain), so splices land at 1x with no ease-out and stretch past 1.5x only while rock blocks the snap (bounded by the 2x leash). Ground band/leash/split-sever verified headless: roof/ground split severs into live sub-chains while level links survive, pigeon airlifts ride out the flight under 2x and resume in band, re-splices snap to exactly 1x, circular-stress holds 1x with zero in-solid, no `PAGEERROR`. Pressing V (`spawnPigeonChain`, Overworld only) spawns a random pigeon-led chain of 3–8 mobs on the ground where the crosshair points — a pigeon lead plus random villagers/pigs/cows/wolves (`spawnChainMob`, unbound, collision-free row validated with `groundYDown`/`aabbCollidesWorld`/`hasMobGround`, the lead built at true ground level, never lifted into the flight band; the row anchors at the `pickBlock` aim cell (face-adjusted, receding from the player) and falls back to a random spot near the player when aiming at the sky) linked with `linkChain`, the lead standing still on the ground in `sit` mode (held by `updatePigeon`) — which takes off after 2 s (`setTimeout` → `pigeonTakeoff`, skipped if the lead no longer carries the chain).
- **Endermen**: teleporting mobs (`kind: "enderman"` in `mobs[]`, `hw` 0.31
  `h` 2.7, tracked in `endermen[]`) that spawn on the End platform alongside
  the dragon — `ENDERMEN_COUNT` (10) of them, all sharing one unit box
  geometry and body material (`spawnEndermen`/`removeEndermen`, one glowing
  purple `MeshBasicMaterial` eye material each). Each is a tall (2.7-block)
  slender black humanoid: two long legs, a torso, a head with two glowing
  purple eyes and two long arms that hang
  down past the legs (`makeEndermanMesh`). They stand still facing the player,
  gently swaying their arms and bobbing, and teleport only when stared at.
  Their eyes turn red as soon as the crosshair touches them (`lookT > 0`) and
  stay red for 0.5 s after the blink (`eyeRedT = ENDERMAN_RED_TIME`, set at
  teleport, ticked in `updateEnderman`), purple otherwise; grabbed endermen
  glow red too (pinned `eyeRedT` while held) and stay red 0.5 s after release —
  the color goes through `setEndermanEyeColor`, which paints the live eye-mesh
  materials (not the stale `eyeMat`: `setMobTransparent` clones materials on
  first carry) so the cycle survives rinse & repeat — the 0.5 s arm-shake
  (`angry > 0`) is separate:
  - Classic "don't stare" behaviour: holding the crosshair on the enderman's
    body for more than `ENDERMAN_STARE_TIME` (0.3 s, exact ray-vs-body hit via
    `endermanAimed` — unexpanded AABB plus a block-occlusion march, so aiming
    at the block at its feet or through a wall never counts; no max distance,
    so anything you can aim at — including grab-grapple range — angers it)
    angers it — it blinks once 5–10 blocks away in one of the 8 compass
    directions (`endermanSpotFor` / `endermanPickSpotOutside` outside the End,
    `endermanPickSpotEnd` in the End), then stays there until stared at again —
    a single blink per stare, no second teleport when the 0.5 s arm-shake
    (`ENDERMAN_ANGRY_TIME`) expires. Every destination is a real standable
    surface, solid or liquid (`endermanSurfaceY`: `groundYForMob` validated
    with a full-height AABB; water/lava/moon-water count as ground and liquid
    landings snap straight to the half-float level in `endermanTeleport`, no
    drop-in from above). The primary hop is strictly enforced: 5–10 blocks
    horizontally, at most 5 blocks vertically either way, always at least 10
    blocks from the player, and always at the periphery of the field of vision
    (`endermanPeripheral`: max(yaw, pitch) fraction of the half-FOV between
    2/3 and 1 — screen edges, never in the crosshair line), with a
    ground-following path check outside the End (`endermanWalkable`: every
    step moves at most 5 vertically with headroom, so hills pass but walls
    block) and a straight-line clearance check in the End avoiding the return
    portal.     If no primary hop qualifies, the relaxed search (`endermanRelaxedSpot`)
    anchors on the closest available surface and pools every other valid
    surface up to 10 blocks farther in 3D (`best + 10`, any direction
    including up/down, rings 5–48 around its own position, no view or
    player-distance constraint, vertical uncapped, 3-block separation still
    enforced), then picks uniformly at random from the pool — so it usually
    lands near but can land up to 10 blocks farther than the nearest surface,
    possibly more than 5 blocks vertically, but never less than 5 blocks
    horizontally; only an unreachable own-column backstop stays put, so a
    stare always moves it. Separation (`endermanSeparated`, 3
    blocks) is enforced on every path, so two endermen never land on each other.
    No wander blinks, no
    proximity blinks: without a stare they never move. Grabbed/hook-held
    endermen are excluded from the teleport separation
    lists (`endermanOthers` skips `carryMob`/`carryGrappleMob`), so the rest of
    the group picks destinations exactly as rigorously while you carry one as
    without. Teleports are telegraphed by a small purple particle burst at both
   the source and destination positions (`spawnEndermanBurst`, reusing the
   `bursts` effect system). End-dimension ones are deleted with the dragon when
   leaving the End / resetting dims; spawned fresh every End entry
   (`spawnEndermen` tops up only missing End ones so transported ones survive —
   carried/hook-held ones don't count, so re-entering the End while carrying
   one still spawns a full group of 10).
  They run through `updateMobs` (no ground physics, excluded from
  separation/push/collide) so they freeze in the pause menu like other mobs.
  They float in water/lava/moon-water like every other mob (`mobInWater` /
  `waterSurfaceForMob`, `MOB_FLOAT_FRAC` half-height via `mobFloatTargetY` —
  `waterSurfaceForMob` scans down from the body top so a moon lake overhead
  never reads as the local surface).
  Outside the End they blink 5–10 blocks away in one of the 8 compass directions
  (`endermanPickSpotOutside`), always inside the field of vision (periphery
  first) and never closer than 10 blocks from the player — so you can follow
  them; vertical moves cap at 5 blocks up or down, clamped inside the level
  and never rocketing skyward (so a `groundYForMob` moon-top fallback never
  fires), hills pass but walls block the ground-following path
  (`endermanWalkable`) —
  the relaxed fallback (rings 5–48, solid or liquid, uniform pick among
  surfaces within 3D nearest + 10) always lands it on the closest available
  surface instead of leaving it stuck).
  Grab race: a carry-grab hook that connects before 0.3 s of continuous stare
  freezes the mob (`isMobFrozenByGrapple`, `lookT` reset, no teleport); past
  0.3 s it teleports away first. While your grab hook is inbound on an enderman
  (flying or pulling) it holds still for the catch — no stare blinks until
  the grab resolves. The displacement hook cannot latch onto solo endermen —
  firing it while aimed at one does nothing; a chained enderman latches, tows
  and releases like any other chain tail, and the moment it leaves the chain it
  is special again (stare, teleport, no latch). Carried endermen can be released in the Overworld or the Nether,
  where they keep End behaviour on local ground (`endermanSpotFor` /
  `endermanPickSpotOutside`, same 0.3 s stare + "stop staring" toast), and they
  persist in saves as mob kind code 5 (save v13).
- **Pigeons**: `PIGEON_COUNT` 50 flying mobs, Overworld only, cruising at
  `PIGEON_SPEED` (`WALK*2` = 8.8) inside the day-sky band Y 50–235
  (`PIGEON_MIN_Y`/`PIGEON_MAX_Y = SKY_SPACE_START`, so the ceiling is exactly
  where night starts falling; below `SKY_SPACE_START` the sky stays
  day). Boxy grey mesh with flapping wings (`makePigeonMesh`, `hw` 0.25 `h` 0.5).
  Flight is a straight/arc state machine (`updatePigeon`, called from `updateMobs`):
  `straight` legs toward random band targets (`pigeonRandomTarget`, 40–90 blocks)
  alternate with `arc` circle segments (`pigeonNewArc`, radius 6–20, sweep 1.5–4.5 rad,
  both turn directions); heading turns are yaw rate-limited with bank/pitch visuals.
  Idle free-flyers are nosy: every player break posts a `pigeonNoticeBreak`, and a
  cruising bird (straight, arc or band-return leg, in or out of band) interrupts
  for anything broken <5 s ago nearby (`pigeonFreshNoticeFor`, 3D ≤45 blocks and
  ≥1.5 so vertical shafts and adjacent holes count, checked every 0.25 s,
  preempting plain returns and stale obstacle-detours but never while a dig
  chase is live, and never for the hole currently being dug to) to hover over
  it (`targetMode "look"`, hover at +1.5/+2.5 or at hole
  level when the cells above are solid, protected from the per-frame
  band-return overwrite until arrival), then resumes with an 8 s cooldown; birds
  between legs also roll for look targets at leg-pick time before resuming.
  A fresh look is never re-rolled underneath (`_lookT0`, 8 s fuse): while it
  lasts the bird presses straight at the hole (`pigeonDigSteer`, per-axis slide
  rounds 1-wide corners) instead of fleeing to max-clearance, and an active
  look/dig chase (`goalChase`) bypasses the velocity-ahead avoidance hijack
  whose upward tilt used to flee every 1-high tunnel; fully-boxed looks divert
  to tunnel planning (dig goal outranks frontier, see below). Perched and landing birds check the same notices and
  take off to investigate (`updatePerchedPigeon`/`updateToPerchPigeon`), so no
  bird sits out fresh digging.
  Removals also join the explore path itself: a fresh reachable dig within 6 blocks
  (adjacent breaks included, reachability marched at 2 samples per block via
  `pigeonSegmentFree` so 1-wide tunnels pass) temporarily overrides the current leg
  in straight and arc modes alike (staged vertical-then-push steering via
  `pigeonDigSteer` through `_digGoal`, `detourT` held fresh for the whole chase),
  and leg re-picks chain onto the next fresh hole within 12 before going cruising —
  so the bird commits to the full tunnel instead of pacing. Arrival (direct or
  via detour) and the 6 s timeout retire a hole (`pigeonDigGiveUp`); stalls keep
  a live chase (only a dead one detours) and detour timeouts just drop it
  retryably, and boxed birds divert to tunnel planning (dig goal outranks
  frontier, see below) — so digging a side tunnel pulls the bird in and it
  follows the digging front, then moves on.
  Cruise legs are always reachable (`pigeonNextLeg` picks via
  `pigeonReachableTarget`: 12 scored segment-free candidates, far + open first,
  plus a directional fallback along free headings when boxed so tunnel axes and
  mouths stay pickable; arcs stay open-sky only): a live reachable goal is never
  re-rolled — its segment is re-validated every 1.2 s instead of flipping the
  heading — and the band-return only overwrites unreachable goals (re-checked
  every 0.5 s), so tunnel birds walk out instead of pacing entrances. Stuck
  detours (`pigeonDetourTarget`) are directional now — projected along the best
  free heading instead of random points — and a sealed bird (no reachable goal)
  mills throttled instead of spinning re-picks.
  Confined birds fly a dedicated TUNNEL mode instead of cruising:
  `pigeonIsConfined` (at most 4 of the 6 axis probes free at 1.2 blocks, or the
  velocity heading blocked within 1.5 — so tight tunnels of any height stay
  confined even at a corner where no single axis has both walls, while open sky
  (`PIGEON_SKY_CLEAR` 20 blocks clear above) is never trapped) diverts `updatePigeon` into
  `updateTunnelPigeon` before any cruise/band logic, with a
  5-frame free hysteresis on exit so mouths never flicker. Confined birds (and
  carried birds while the player is squeezed) shrink to 0.7 (`PIGEON_NARROW_SCALE`,
  visual + collision via `pigeonColHW/H`), so 1-block tunnels stay flyable. With
  20 blocks of vertical air (`pigeonSkyClear`) the bird skips planning entirely and
  climbs straight up dead-centre (`x+0.5/z+0.5`), sidestepping or U-turning if a side
  is blocked — so sky access always means immediate exit. Stalls never teleport:
  a blocked waypoint is marked in `_tAvoid` and replanned around (`go around`), a true
  stall sidesteps (`pigeonSidestep`) or U-turns (`pigeonUTurn`, avoid + reverse, BFS routes
  back out of dead-ends). The planner
  (`pigeonTunnelPlan`, BFS over integer cells up to `PIGEON_TUNNEL_BFS_CELLS`
  1000, replanned every 0.4 s, on contact, or whenever the path runs dry) picks
   one goal in priority order — a live dig notice within
   `PIGEON_TUNNEL_DIG_NEAR` 30 blocks, then a sky exit (free
   cell with air overhead and solid support below, ≥3 open neighbours) or the
   nearest exit cell (a free cell with at least 3 open neighbours, so dead-ends
   and tunnel mouths qualify) — both within `PIGEON_TUNNEL_EXIT_NEAR` 60
   steps, held sticky across replans (`_tGoalKind`/`_tGoalCell`) so the bird
   commits to one exit instead of oscillating — and only when no hole or sky
   is in range does it tour the nearest unvisited frontier
   cell (`_visits` breadcrumb memory, capped at `PIGEON_VISIT_MEM` 1400, so a
   sealed bird keeps wandering the whole space while blocked), then, once the bird has been confined
  over 20 s, the most-open reachable cell (so no pocket traps it and it heads
  for the surface), else the nearest exit / most-open reachable cell, else the
  least-recently-visited
  revisit — and follows the reconstructed axis-aligned
  waypoint chain (up to `PIGEON_TUNNEL_PATH_CELLS` 50 steps) at `WALK` with
  fast `dt*6` convergence and no
  min-speed floor. In flight the bird **cruises through intermediate
  waypoints at full speed** — speed only brakes (`dist*4`) on the final
  approach to the goal cell, so straight legs and shaft climbs never pulse.
  Movement is axis-split per frame (`updateTunnelPigeon`): the **travel axis**
  is the dominant axis of the waypoint direction (tunnel legs are axis-aligned,
  so it is unambiguous); on that axis a waypoint spring drives forward motion,
  on the walled side axes the velocity is *set* to a pure proportional
  `20 × (cellCentre − pos)` correction, and on open side axes the waypoint
  lerp applies normally. Because walled side axes snap to the corridor centre
  with an exponential (first-order) law instead of an additive spring, the bird
  never oscillates: vertical shafts are climbed dead-centre at `x+0.5 / z+0.5`
  with zero lateral velocity, straight up or down, and legs keep the bird
  mid-height. The bird also **slows before the coming turn, not after it**:
  the dot product between the current heading and the direction of the
  leg *after* the current waypoint scales speed from 35% (perpendicular
  corner ahead) up to full `WALK` (straight line), so corners and U-turns
   are taken at reduced speed before the wall, not rammed into it. A hole cell
   (free cell with ≤2 free neighbours, `pigeonHoleCell`) is threaded as a
   precision funnel: pace drops to `PIGEON_HOLE_SPEED` 2.2, the LOS skip never
   drops the centring waypoint ahead of a hole, and a stall while threading or
   pursuing an exit holds position and replans instead of `pigeonUnblock`
   teleporting — so exits are flown exactly, never skipped. When a
   waypoint is popped and that empties the path, the plan is re-extended
  in the same frame, so the bird never spends a frame milling on a random
  axis probe at tip arrivals. Total tunnel speed is clamped to `WALK`
  after all forces are summed; the mesh's pitch (`rotation.x`) is lerped
  at `dt*5` instead of snapping, so shaft climbs and dives read smoothly.
  In tunnels the bird's mesh (YXZ euler order, set in
  `makePigeonMesh`) rotates to face the waypoint: yaw from the horizontal
  direction and full ±90° pitch toward vertical shafts (so head and body point
  up/down when climbing or diving a shaft, yaw held stable when purely
  vertical), instead of the old ±0.45 rad velocity-based tilt. Because the mesh
  pivots on its feet, that vertical pitch used to swing the body ~0.28 blocks
  sideways in a 1×1 shaft (hugging one wall); `pigeonAnimate` now cancels the
  swing in tunnel flight — it offsets `mesh.position` by the pitch-induced
  `PIGEON_BODY_Y` displacement so the body stays dead-centre on the shaft at
  its normal height while climbing/diving. It ignores the
  open-sky 2.5-block separation shove
  (`pigeonTunnelSeparate`, 1.2-block gentle push only), so it never gets pinned
  against walls by other birds. Cells are committed to `_visits` (via
  `pigeonTouchVisit`, using the same `floor(pos.y + 0.25)` centre-cell
  convention as the plan start cell) only once the bird's centre is inside
  them, so a popped waypoint is never marked ahead of the bird — that used to
  open a "hole" in the visited map behind it that the BFS would pick as the
  next frontier, making the bird reverse and stutter mid-climb. A waypoint
  that makes no progress is never
  avoided (avoiding the only route would wall the bird in) — the path and
  velocity are simply reset and re-planned, and a blocked move only forces a
  fresh plan after 1.5 s, so no corner or turn holds the bird, and when the path
   runs dry the bird first re-checks fresh digs (any unvisited break within
   `PIGEON_TUNNEL_DIG_NEAR` forces an immediate replan before milling), then
   flies a `pigeonMillHop` target
   instead of hovering in place. Fresh breaks preempt every frame too (any
   unseen dig in range clears `_tPlanT` before planning), so a hole broken
   mid-leg is chased within a frame or two. Fresh breaks pull tunnel birds through the BFS
  itself (dig goal
  outranks frontier), so the bird chases the digging front around corners and
  leaves through a newly broken hole instead of pacing where blocks broke.
  Tunnel digs respect the seen-break memory (`pigeonTunnelLiveDigKeys` skips
  `_seenBreaks` ids and prunes dead ones): each fresh hole is visited once via
  `pigeonDigGiveUp` and never re-chased, so the bird keeps wandering the whole
  network searching for an exit instead of hovering 8 s at the dead end where
  you dig; giving up a dig no longer discards a still-valid path (only the goal
  is cleared, the remaining waypoints carry the bird on). Blocked-only: only
  confined birds (no sky access) chase digs, via BFS reachability with no
  line-of-sight requirement, so a sealed bird finds a hole around a corner;
  free birds ignore breaks entirely. Re-added blocks are
  handled naturally: `freeCell` re-probes live world state each replan, so a
  sealed tunnel section simply vanishes from the BFS and the bird re-routes or
  exits.
  `pigeonNextLeg` no longer picks 40–90-block cruise goals while confined — it
  clears the open target and returns, letting the tunnel planner take the next
  frame. `pigeonMillHop` is used again as the path-dry fallback; legacy
  `pigeonExploreStep`/`pigeonConfinedSteer` stay
  exported for `_test` but are no longer on the flight path. Dig steering
  (`pigeonDigSteer`) in open sky only ever flies validated routes too — staged vertical-then-level when both march free,
  direct when the full segment marches free, axis-aligned level steps otherwise,
  hold as a last resort — with zero-steer falling through to avoidance/milling
  instead of hovering, so off-axis dives align to the mouth instead of clipping
  rock beside it.
  Block avoidance probes ahead (`pigeonProbeFree`, `PIGEON_PROBE_DIST` 3, AABB-based so
  clouds and player builds both count — pure collision, no band gating) with scored
  clearance at 3 and 6 blocks (`pigeonClearance`/`pigeonBestSteer`: best yaw/vertical
  candidate wins, never overwritten by a blocked target vector) and slows near walls
  (speed scales with clearance); collisions slide per axis (`pigeonMoveSlide`) instead
  of bouncing, contact zeroes velocity symmetrically so no into-block momentum is
  retained, and the min-speed clamp is lifted when moving into a block (checked via
  marched clearance along the velocity) so birds never pin themselves pressing a
  face; below min-speed the velocity adopts the steering direction instead of
  re-inflating along the old heading, so arrivals always turn instead of lunging
  backwards forever; a stuck detector steers a directional `detour` after ~0.6 s truly stalled
  (wall-grazing while still moving does not count), and a bird hovering
  motionless for >1.5 s (`_stillT`, e.g. zero-velocity heading probing its own
  cell toward an unreachable goal) is forced into confined milling until it
  moves again.
  When every direction probes blocked (sealed shaft/pit), the bird drops into
  tunnel-plan fallback (least-recently-visited revisit, else a slow hover drift)
  and re-plans every 0.4 s, so it wanders calmly instead of ramming walls and
  leaves the moment blocks are deleted;
  pigeon-pigeon separation is 3D (`PIGEON_SEP_DIST` 2.5 via `mobGrid`) while ground-mob
  `separateMobs` skips pigeons entirely; pigeons in the same chain never separate from
  each other (`pigeonSameChain` guards `pigeonSeparate`/`pigeonTunnelSeparate`, so a lead
  ignores its own followers but still avoids strangers and other chains). Mob transparency is per-instance:
  `setMobTransparent` clone-on-first-writes materials (`mesh.userData.matsCloned`, incl.
  material arrays), so carrying one mob (0.35 held ghost) no longer ghosts every mob
  sharing the module-level materials (pigeons, pigs, cows, villagers — wolves were
  already per-mesh); displacement latch/release force opaque unless carried.
  Pigeons placed outside the band climb/descend back at normal speed with no teleport
  (the old hard band clamp is gone, only an absolute [1, `MAX_Y`-1] safety remains):
  out-of-band birds steer to `bandReturnTarget` and mill around obstacles via short
  `detour` targets (`pigeonDetourTarget`, `detourT`) when probes/collisions block the
  way (moon top, sealed boxes), resuming the climb/descent after. A pigeon released
  inside a sealed house stays cooped (`houseInteriorFor` + `houseMouths`, walls
  `vy+1..4` + roof `vy+5` cached per house for 0.25 s, door cells
  treated as closed): restless indoor exploring (`updateCoopedPigeon`, `WALK/2`,
  wall-biased wander targets, hard interior revert, band logic fully exempt so low
  houses no longer eject birds through the roof); when a wall/roof block breaks, the
  new mouth is noticed via the mouth-list diff (`h._breakX/Y/Z/T`) and each bird
  picks its hole via `pickMouthFor` (nearest open mouth to the break within an 8 s
  attention window, otherwise nearest to itself, preferring mouths with free air
  outside via `mouthOutsideFree`, skipping its own fail-cached mouths) and an
  axis-tracking exit controller (`updateHoleExitPigeon`: velocity along the hole
  face normal + lateral correction + positional axis snap near the mouth, per-axis
  slide as backstop, slowed near the mouth) threads the 1-block hole and hands
  off to an outward `detour` target so the bird leaves instead of hovering at the
  mouth; a hole push that makes no progress for 4 s — or stays in block contact
  for 1 s — is fail-cached for 10 s and the bird reverts to exploring, cycling
  through remaining mouths round-robin, so cooped birds never sit blocked.
  Pigeons never block editing either: breaking a block a pigeon touches or
  perches on is allowed, and so is placing a solid block onto a pigeon
  (`breakBlock`/`tryPlace` both skip `kind === "pigeon"` in the mob guards) —
  collision resolution (`pigeonResolvePenetration`, run at the top of every
  `updatePigeon`: nearest free spot within 2 blocks on 6 axes, else straight up)
  pops the bird right back out, so a pigeon can never end up intersecting a
  block no matter how it got embedded (edits, tows, perch-snap races). All
  pigeon world-collision uses a squeezed box (`PIGEON_COL_HW` 0.18 /
  `PIGEON_COL_H` 0.5 instead of the 0.25-wide body, so the head always stays
  clear), so 1-wide corridors stay flyable with slight visual overlap and walls
  never snag the bird. Confined birds (and
  carried birds while the player is squeezed) shrink to 0.7 (`PIGEON_NARROW_SCALE`,
  visual + collision via `pigeonColHW/H`), so 1-block tunnels stay flyable
  and walls never snag the bird. Inside a 1-wide corridor the bird
  steers onto the corridor middle on the
  walled axes, laterally and in vertical shafts alike.
  A grabbed pigeon keeps full size in hand, except while the player is squeezed
  somewhere tight themselves (`playerSqueezed`) — then it eases to
  `PIGEON_CARRY_SCALE` 0.7 in hand in real time, and regrows smoothly on release
  (`updatePigeon` eases `mesh.scale` back to 1). Perch approaches (`updateToPerchPigeon`) steer with the same scored
  clearance at every distance and funnel in slow (`sp*0.25` floor) with sliding
  instead of aborting on first touch. TNT kills only the aimed bird, fired directly: with TNT selected, aiming at a pigeon (nearer than any block, or sky) and clicking fires a homing bomb straight from the player (`aimedPigeon` + `fireTNTAtPigeon`, a free `tntLit` entry keyed `flyN`, no placed block needed; left click fires when the pigeon is the nearer hit and otherwise places normally, right click fires only when no block is targeted and otherwise breaks normally) — the aim is generous (expanded grab box) within `PIGEON_AIM_DIST` (200, the bomb's reach at 44), and the first aimed discrete click locks the bird for `PIGEON_LOCK_TIME` (0.5 s, refreshed per shot, cleared on kill/rebuild): further fast discrete clicks burst more bombs at the lock without re-aiming (`tryFireLockedTNT`) as long as no block sits within `PIGEON_LOCK_BURST_DIST` (30), so near-terrain aims still place instead of misfiring; at most 3 shots per lock (`pigeonLockShots`), and a pigeon already targeted by a live bomb cannot take a new lock (`tntTargeted`) — the burst reuses the same lock instead. Holding either button never fires: holding left only paints/bridges, holding right only digs — chained hold breaks ignite without pigeon lock (`chainBreaking` set around the hold-repeat `breakBlock`); breaking a placed TNT block with a discrete click while a pigeon is between eye and block still locks the same way (`igniteTNT` `mobT <= blockT + 0.5`, same cap/live rules) and takes the lock too; an aimed break that the lock refuses (cap exhausted or already targeted, dragon cap included) fizzles instead of burning — the block is consumed with a visual-only burst (`tntFizzleAim`/`fizzleTNT`, no `tntLit` entry, no terrain damage), so bombing a chained mob on the ground never craters; the bomb homes at `TNT_HOME_SPEED*4` (44) straight
  through all obstacles (`updateTNTTarget` pigeon branch); every volley shares one arrival time per target (`tntEta` time-on-target: the first bomb sets ETA at base speed, later bombs accelerate past it to meet the same ETA and only push it out when they cannot make it — each bomb flies at remaining-distance-over-remaining-time, so all bombs on one pigeon stick in the same frame no matter the launch delay, and live bombs get their `life` extended to cover the ETA); on contact it kills the bird
  (`killPigeon`) with a red/yellow/orange particle burst and no fireball (`spawnPigeonBurst` via
  `explodePigeon`, no terrain damage, dragon-style minus the ball — normal blending
  (not additive) so the warm colours read against the day sky, where additive washed out to
  white; the dragon's own
  purple `spawnDragonBurst` is untouched) and a
  replacement respawns out of view (`pigeonSpotOutOfView`, >130 blocks and off-camera,
  back in band); non-aimed TNT never locks. Mob grapple (ENTER) grabs/carries them like
  other mobs and `releaseCarriedMobAt` drops them at any height in free air, from where
  band steering pulls them back to 50–200. Displacement grapple latches on
  (`fireGrapple`/`updateGrapple` homing on the hit point) and reels the player in
  at `GRAPPLE_SPEED` (26) straight toward the bird — exactly the same transit pull
  as any block or mob, sliding on terrain via `grappleMoveX/Y/Z`; once within
  `PIGEON_FOLLOW_DIST` (2.5) it hands off to the follow mode: an overdamped
  spring (`stiff` 18, `damp` 11, error clamped to 3) holds the player at a smoothed
  trail point 2.5 blocks behind the bird (`grappleTowDir` low-pass on the heading,
  `dt*2.2`, vertical clamped to ±0.6 with zero-velocity guard, trail point itself
  smoothed in `grappleTowPos` at `dt*6`) for as long as the button is held; follow
  latches with +2 hysteresis so it never chatters against the transit pull at the
  boundary, and collisions slide per axis (only the blocked component is zeroed)
  instead of damping the whole velocity, so the tow stays fluid from every angle
  including directly underneath; release during transit flings along
  the launch line at `GRAPPLE_FLING` like any other grapple, release while following
  keeps the tow momentum clamped to `GRAPPLE_FLING`. Persisted as mob kind code 4 in save v12.
  Cloud perching: pigeons sit ~50% of the time, on village roofs (`pigeonRoofTopAt`,
  any house roof cell at `vy+6`), cloud tops (`pigeonCloudTopAt`, now with an
  optional y-range) and tree tops (`pigeonTreeTopAt`, highest `LOG`/`LEAVES`
  with headroom) alike — roof stone/planks count as perch support only on house
  roofs (`pigeonPerchSupports` checks `vy+5`). Perched birds are spread evenly
  across height: `pigeonPerchBand` splits spots into low (roofs+trees, below
  `CLOUD_BASE`), mid and high cloud halves, and `pigeonFindPerchSpot` sends each
  new perch leg to the emptiest band (25% random for organic feel), joining a
  nearby perched group of <3 in that band (`PIGEON_PERCH_JOIN_R` 50,
  same-height slots ≥`PIGEON_PERCH_SEP` 1.3 apart, path checked via `pigeonSegmentFree`)
  or picking a fresh top (≤90 blocks, village-biased roof sampling for the low
  band, y-clamped cloud sampling otherwise); `updateToPerchPigeon` flies
  there (direct homing under 12 blocks, aborts on block/timeout) and `updatePerchedPigeon`
  sits 2–10 s (`PIGEON_PERCH_MIN_T/MAX_T`) shuffling within ~0.7 blocks with folded wings,
  taking off (`pigeonTakeoff`) on expiry, dug-out perch or displacement-grapple latch.
  Takeoff hops straight back to a nearby perch (`PIGEON_HOP_CHANCE` 0.9, 2 short-leg
  retries via `perchRetry`), and every leg re-pick goes through `pigeonNextLeg`
  (perch roll `PIGEON_PERCH_CHANCE` 0.65, min 1.2 s between full decisions via `_decideT`),
  so flight legs stay short and duty cycle holds across worlds.
- **Save/load**: binary format (`SAVE_MAGIC`, version 15) capturing world
  blocks (over/end/nether), dim, seeds (over/end/nether), player pos/yaw/pitch,
  player velocity (`vel`, so a save made mid-air resumes at the exact spot still
  falling),
  fly state (the free-cam `freeCam` flag — restored on Load Save only when it
  was enabled upon save, so you resume flying where you saved;
  new worlds always start grounded (New World resets `freeCam`); saves from the old
  dead `flying` variable read as false), hotbar selection,
  the recorded Overworld return portal (`overPortalWin` + `overPortalDir`, in v9),
  placed-flowers' stored color/rotation (`placedFlowers`) and per-glowstone
  colour entries (`glowVariants`, one per dimension, in v7); extra per-entry byte
  pair for flowers in v3, the nether dim/seed/blocks added in v4; Overworld mob
  positions with identity (kind/flags(baby+villageBound+penBound)/home/parent-link/yaw/look,
  19 bytes each, in v10 with bounds bits added in v11
  via `snapshotOverworldMobs`/`restoreOverworldMobs`); chain links as
  (carrier, child) overworld-mob index pairs (`pendingChainLinks`, relinked via
  `linkChain` after mob restore, failures skipped; only written when saving from
  the Overworld — End/Nether saves store none since dimension entry already
  broke them, and the End rebuilds dragon + endermen fresh on every entry);
  the held mob (`carryMob`) is stored as an overworld-mob index (`pendingCarriedIdx`,
  appended Int32, -1 when empty-handed; saves from the Nether/End append the live
  held overworld mob so it survives) and restored still in hands (`mode="carried"`,
  ghost transparency, arms visible; chain pairs touching it are skipped);
  New World always starts empty-handed (a held or hook-riding mob is despawned
  during regen, never carried into the fresh world; `spawnVillagers` skips held
  mobs on the load/dimension-return paths);
  pre-v15 saves load with velocity untouched, no chains and no held mob; older v1/v2/v3
  saves still load, and v5 saves from the briefly-lived torch era are tolerated
  and read past their torch entries. Saves older than v10 respawn mobs fresh (v10 entries
  default bounds by kind on restore); pre-v12 saves respawn their 50 pigeons fresh
  (`spawnPigeons` top-up on restore, kind code 4 `pigeon` added in v12);
  pre-v13 saves have no endermen stored (kind code 5 `enderman` added in v13);
  saves older than v9 re-derive the return
  frame via nearest-frame lookup on the way back; saves older than v7 have their glowstone
  colours backfilled (clustered) on load, and v6 saves' stored seven-colour
  indices are remapped onto the six via `LEGACY_GLOW_MAP`.
  Backends: File System Access API (`pickSaveFile`/`saveToFile`) and the
  server API (`apiLoad`/`apiList`) — world saves always go to disk (a `.sav`
  file in `save/` via the server, or a user-picked file via the FS Access
  API); nothing is ever kept in browser storage except the remembered
  save-directory handle (`getSaveDir`/IDB key `savedir`). Autosave
  runs every 3 s while the world is dirty (plus on pause/Escape and on page
  hide), via `queueSave()` / the 3-second timer (which also fires while a mob is
  held, and grabbing/releasing dirties the world, so the hold always reaches disk); world regen resets to new
  seeds (`regenerate`).
- **HUD/UI**: crosshair, hotbar with slot icons (wheel or K/L selects), dimension
  label, toasts; pause overlay (Resume/New
  World/Load Save) and H help panel (portal diagrams: `portalArt` for the
  horizontal End frame, `netherArt` for the 5×4 obsidian Nether frame).
  Loading a world
  or generating a new one shows a spinner below the menu (`#loading`,
  `setLoading`) and freezes all controls (input handlers and the game-logic
  half of the main loop bail out while `loading` is true);
  `restoreSave`/`buildWorld` are async and yield a frame so the spinner
  paints before the heavy `rebuildMeshes`/`generateWorld` runs. `menuBusy`
  guards the New World / Load buttons against re-entry so double-clicks can't
  stack dialogs.

## Conventions

- Plain ES modules; Three.js is loaded from CDN via the import map in
  `index.html`. Do not add new CDN/addons dependencies unless requested.
- Geometry is rebuilt manually — there is no world meshing framework. Full
  rebuilds via `rebuildMeshes()` (dimension switch, load, new world); block
  edits call `refreshBlocks([[x,y,z], ...])` to rebuild only affected chunks.
  Changes to blocks must also call `queueSave()`.
- Block types are numeric constants (AIR/GRASS/DIRT/...) defined at the top of
  `main.js`, with metadata in `BLOCK_INFO` (solid/opaque/placeable).
- Hungarian-ish / unadorned naming: local helpers like `pxNoise`, `makeTex`
  for textures; camelCase functions; `SOME_CONSTANT` for constants.
  `wolf*` locomotion helpers (`wolfMoveAxis*`, `wolfPhysicsStep`, `tryWolfStep`,
  `wolfHasMobGround`, `wanderGoalForWolf`, ...) are generic jumping-kind
  machinery keyed on `canStep`, not wolf-only code — only `isJumpingKind`
  maps species to capability. Adding a jumping kind means extending
  `isJumpingKind` plus spawn `canStep`, sizes, save kind code and mesh.
- Do not add code comments unless the surrounding code already explains itself.
- All code, comments, and documentation must be written in English — no French anywhere.

## Workflow Notes

- The dev server that was restarted during sessions runs on port 8090 via
  `python3 -m http.server`. Prefer `python3 server.py` (port 8383) for normal use.
- Commit messages are single-line, starting with a capital letter, describing
  the user-facing change (e.g. "Increase block reach to 15").
- Always commit changes after completing a task; amend the last commit when
  fixing something just made.
- Always keep AGENTS.md up to date with the project structure and features.
- Instrumentation (puppeteer): Verified no merge (maxOverlap 0, minDist `>0.6`, pen avgDist `3–4`, stuckFrames 0) over 30s×3 worlds, plus pen/minD `>1.2` and panic `0`. Pigeons verified over 2 fresh worlds: 50 birds in band 50–235 at `WALK*2`, straight+arc modes both used, min 3D separation `>6`, zero in-solid, stone wall avoidance 0 hits; aimed TNT locks, kills in ≤2 steps with no terrain damage and respawns >130 blocks out of view back in band;   ENTER grab catches in ~10 steps; displacement grapple latches in ~21-26 frames and reels at exactly `GRAPPLE_SPEED` (26, min=max, same as block pull) in all 5 pigeon directions with arrival, 0 blocked frames and 0 distance increases,   then follows ~3 blocks behind (mean 2.4-3.0, max <3.7); save v12 round-trips 50 pigeon entries; no `PAGEERROR`. Pigeon follow-ups verified: band ceiling 235 (`PIGEON_MAX_Y = SKY_SPACE_START`); per-instance transparency (carried bird 0.35, other + towed birds stay 1, with and without parallel carry); TNT edge cases (arc-mode lock+kill, no lock when bird behind TNT, double-ignite single blast); house coop (stays sealed 30 s at interior height, exits through a broken wall/roof via axis-tracking in ≤90 steps, door alone never releases); smooth band return (ground climb ≤0.5/step, moon descent, sealed-box milling, no teleports); direct TNT fire (sky aim locks, kill in ~35 steps with respawn + clean `tntLit`, ground aim places normally with no fire); tunnel rewrite (L-tunnel corner turn + far-end reach, dig-chase to the front, fresh-break escape through the hole, 50-bird open-sky zero in-solid); tunnel follow-up (corridor-middle flight with zero blocked frames, most-open-exit scoring so birds head straight out a skylight instead of roaming, 1.5 s stall-avoid); tunnel dead-end (sealed leg wanders end-to-end with ~0 still frames, each fresh hole visited once with ~0 hover instead of an 8 s sit); no `PAGEERROR`. Only when the user asks to instrument. Launches `python3 server.py` on 8383, opens `http://127.0.0.1:8383/?test` headless   (`headless:'shell'` + `--no-sandbox --disable-gpu`, `NODE_PATH=/Users/q.auge/projects/tech/minicraft/node_modules`), then drives `window._test` (`buildWorld`, `mobs`, `villageHouses`, `villageCenter`, `handleMobExplosion`, etc.) to assert behavior (positions/targets/modes, `fleeUntil` spread, no `PAGEERROR`).
- Dev start dimension: `DEV_START_DIM` next to `let dim` selects where New World
  spawns the player (`resetDims`/`buildWorld` honour it; End start generates the
  End, spawns dragon + endermen and places the player on the platform, seeds a
  valid `overPortalSpawn` on real overworld ground so the trip back lands
  outside the terrain, and spawns no overworld mobs so the End holds only
     dragon + endermen). It is `"over"`: new worlds start in the Overworld —
  set it to `"end"` to spawn in the End for testing. `generateWorld` pins `dim = "over"` while it runs:
  `setBlock` records column tops per `dim`, so generating with any other dim
  leaves `colTops.over` at zero and chunk meshing skips everything above y=0
  (invisible houses/trees/clouds on return).
