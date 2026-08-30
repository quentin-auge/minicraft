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
   slow `JUMP_FLING_DAMP` (6) decay until you land (jump inertia `jumpBoost` stacks on consecutive sprint jumps, `jumpIdle` resets when stalled or idle 0.12s). Jumping requires a fresh press — holding Shift/Space on the ground does not auto-repeat (`spaceJustPressed` sets `jumpBuffer` `JUMP_BUFFER` 0.2s, consumed only when `onGround`; `spaceJustReleased` halves upward velocity for variable height, the 200ms buffer keeps fast bunny-hops/`jumpBoost` responsive around landing time). Rebound on water/lava: falling into water/lava while holding Shift/Space while a recent jump is tracked (`jumpOriginY`/`jumpPeakY`/`lastSpaceDownY`/`jumpHoldContinuous`) bounces back to that height (`waterSurfaceTop` delta → `sqrt(2*GRAVITY*delta)`, sprint-boosted, `bounced` flag) instead of damping. Swimming: full-AABB water detection (`headInWater` checks `pos.y+0.01` to `pos.y+PLAYER_H-0.01` for WATER/LAVA), deep ascent `SWIM_ACCEL` 2.0, shallow hold at 65% immersed (`targetY = surface-1.17`, `err*4` spring with `SWIM_BRAKE*2`, `SWIM_AREA` 10) — player floats waist-chest deep, not feet-on-surface. Debug HUD (`#debugHud`, toggled with =/+) shows pos/vel/onGround.
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
  refused inside the player's body). Left click places, right click breaks (both work while flying — build anchor tracks camera). Holding left click is two-phase: while the mouse moves, it paints — each movement event places one block where the cursor aims, but only onto a block of a different kind than the selected one, and only within `CHAIN_RANGE` (4) blocks of any block already placed during this hold (`clickAnchors`, reset per press). If the mouse never moved during the hold, after 1s without moving (`leftTimer`) the hold latches into bridge mode (`leftStairs`): the staircase builder below starts immediately and keeps building until release — mouse movement mid-bridge is ignored, and once the mouse has moved during a hold (`leftEverMoved`) the bridge can never engage for that hold. Holding right
  digs a straight tunnel: each repeat breaks the live raycast `currentBlock`, so
  removing one block exposes the next one behind it; moving the mouse while holding right starts the dig immediately (skipping the 1s gate), and chained breaks are limited to `CHAIN_RANGE` (4) blocks of any block already removed during this hold (`clickAnchors`). Holding either button chains the action after 1s
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
- **Grappling hook**: hold middle mouse click on the targeted block to fire a
  hook that first flies fast to the target (`GRAPPLE_THROW = 70`, while it
  flies you keep full control — you keep falling and moving, the rope follows
  you; the hook flies straight through water and lava — it never grabs a
  liquid, only the solid block behind it), then hauls you in a straight line onto that block
  (`GRAPPLE_SPEED = 26`, feet on its top, zeroed velocity); releasing mid-pull
  keeps your pull momentum — you're flung along the hook's launch-line
  direction (start→target) at `GRAPPLE_FLING` (~1.3x grapple speed), with the
  same boost applied to every axis so the launch follows the grapple's natural
  angle and gravity takes over from there; the fling keeps you moving in that
  direction (up, down or sideways) with mild friction — pressing movement keys
  steers the momentum rather than replacing it — until you touch the ground
  (which cancels it) or it runs out. The pull resolves collisions per axis
  (`grappleMoveX/Z/Y` with sub-steps capped at 0.4, so it never embeds you in
  terrain): when the landing spot on top of the target's column is clear
  (`grapplePass`, recomputed each frame via `blockedBody`), that column is
  skipped in the collision check so you can land on top from any direction —
  but only when the grabbed block is the column's top block or the one directly
  below it (a free pillar up to 2 tall; `grappleTopY`); a block buried deeper
  in a taller column is treated as a solid and stops you flush against it
  instead of letting you climb to the top. Any other obstacle in the path stops
  you flush against it and you slide along it (clamped against the blocking
  cell) while the pull is held — once you're blocked (or landed), you keep full
  control and can move/turn freely while hooked. Arriving on a clear solo block
  or 2-block column plants your feet on its top (`grappleArrived`), keeping you
  hooked with the rope attached until you release the button, releasing only
  stays a launch while you're still actively mid-pull (`grapplePulling`) —
  releasing at rest (landed on the block, pressed against an obstacle, or while
  the hook flies) just drops you straight down with no fling or inertia. A thin
  pixelated rope (cube chain ~1/10 block, dense over the whole
  path) plus a blocky hook head shows the pull from the eye to the flying/stuck
  hook. On release the hook detaches and retracts — it zips straight back
  toward your eye at `GRAPPLE_RETRACT` (275) with the rope following, then
  vanishes when it reaches you (or after 1.5 s); firing again mid-retract
  cancels it.
- **TNT**: lighting fuses (HUD fuse sprite), delayed explosions with blocks
  destroyed/tossed and particle flashes. Breaking a TNT lights a 3s fuse and
  explosions chain-react: a blast near another TNT block lights it, and a lit
  TNT caught in a blast (or re-broken) detonates immediately. In the End, a
  lit TNT targets the Ender Dragon: the TNT cube flies up at it, sticks onto
  its body and detonates on contact with a big purple particle burst (each
  stuck blast = 1/8 of its HP, so it takes 8 TNT to slay). A dragon-homing blast deals dragon damage only —
  it never destroys terrain, so no crater is left where the TNT launched; a
  homing bomb that never sticks detonates in air after `life` (3s fuse + 2s chase).
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
  `breakBlock` and the TNT blast loop). Returning drops you beside the
  Overworld portal (never on it) and the landing spot is re-resolved on live
  terrain (`resolveSpawn`: a ring search from the recorded entry spot that
  requires full body clearance, solid ground under the feet, and no portal
  interior — so a build or blast at the old spot never leaves you stuck in a
  wall, floating, or standing in another frame; its last-ditch fallback scans
  the entry column from `MAX_Y` down (skipping CLOUD/MOON) and only lands on a top
  solid with body clearance, so it never returns an embedded point), flying is forbidden in the
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
  active portal. Fills render as per-cube `Mesh`s in a `THREE.Group` and are
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
  (`overPortalSpawn` = a clear solid spot ~6–9 blocks in front of it,
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
  random waypoints, low "skim the floor" runs and high soars (about twice the
  platform height), banking turns and dives), re-picking a fresh trajectory
  each lap; its loops alternate tight inner passes and wide sweeps that swing
  past the platform edge (waypoint radii 12–30, clamped inside radius 30), so
  you get a clear view of it when TNT sticks and blows up on it. Its path is
  player-agnostic — it never aims at the player (it was changed to stop
  converging on them), flying a pure ambient circuit instead. It flees homing
  TNT: any non-stuck airborne TNT within `DRAGON_FLEE_DIST` (16) pushes the
  dragon away (`dragonFlee` smoothed, `DRAGON_FLEE_SPEED` 11 ≈ TNT home speed)
  until the bomb detonates or gives up. Its path stays
  clamped above the platform surface, so it never clips through the platform. Built from Three.js primitives only — boxy, cubic
  style: a blocky torso/belly, box horns and five head spikes, glowing purple
  eyes (unlit), translucent purple bat-wing membranes (mirrored), and
  segmented forked tail boxes; shared geometries/materials. It spawns black and
  re-paints itself with every TNT hit (`paintDragon`, cycling the `DRAGON_PAINT`
  palette of 8 neon shades — hot pink, green, gold, blue, orange, crimson,
  violet, cyan — across the stored body/belly/plate/bone/membrane materials).
  It breathes a
  long-reaching spray of fading purple cube fire from its mouth (about 3x the
  platform reach) — mostly while diving at the player (~60% of dives), with
  occasional level-flight breaths in between. Its flight has small random
  speed bursts (surge) with slightly faster wing flaps. Animated via
  spline-driven yaw/pitch/bank orientation, wing flap with speed, neck/head
  sway, tail wave and body bob. It has a boss health bar (HUD) and can be
  killed with TNT blasts (see TNT). At 0 HP the dragon does not die instantly:
  it freezes and rapidly stroboscopically flashes through every entry of the
  `DRAGON_PAINT` palette (a new color every `0.08`s) while shaking in place for
  1s (`dragon.dying`/`deathFlash`/`deathIdx`, driven inside `updateDragon` via
  `paintDragonPalette`; `damageDragon` now only starts the countdown instead of
  killing outright), then death triggers a huge double-layer purple
   explosion, opens the return portal and removes the dragon. Resources are
  disposed when leaving the End.
- **Villagers**: 24 villagers (8 houses ×3: 2 adults+1 baby, `VILLAGE_RADIUS 28` stone plaza at `villageCenter.y` integrated in `generateWorld` via `computeVillageLayout` before terrain — override `h=villageCenter.y`, `intersectsVillage` skips tunnels/rooms/stairs/trees, `placeVillageHouses` `7×7×5` seeded `hash2` with `|dx|<9&&|dz|<9` veto). Houses enterable (2-wide door facing centre, window opposite, flat roof, palette variance). Villagers use same AABB/gravity as player (`aabbCollidesWorld`/`moveMobAxisX/Z/Y`/`mobPhysicsStep` `GRAVITY 37.44`, moon gravity `*0.5` at `MOON_Y-MOON_R`, `hw 0.27/0.16` `h 1.82/0.98`, `villageBound` clamp, `WALK/2` `2.2` (`WALK 4.4`), flee `WALK×2` `8.8`, liquid float `WATER/LAVA/MOON_WATER` `vel*0.96`). Collisions: monde + joueur (`pushMobsFromPlayer`/`moveAxisX/Z` push via `nearbyMobsFor` grid) + entre eux (`separateMobs`/`mobCollidesOther` via `MOB_GRID 8` `mobGrid` `mobById` `buildMobGrid`, `separate` throttled `1/2` frames). Materials cached (`villagerMatCache`/`villagerHeadMatCache`, `villagerGeo` reused) and spawn snapped to block centers `floor+0.5` with `usedBlocks` no overlap. Trous = murs via `hasMobGround`/`mobBlockedAt` (`>0.02` overlap, `!isSolid y-1` but `WATER/LAVA/MOON_WATER` counts as ground, `MOVE_X/Z` auto-step `±1` `hasMobGround`/`!aabb`) — `mobProbeFree` et `findVillagePath` (BFS 4-N `0.5`, `pyHint`, `intersectsVillage`/`isInsideAnyHouse` hors cible) l’évitent; `updateMobs` `mobTick` + `addVisit`/`visitGrid` `VISIT_CELL 8` `wanderGoalFor` least-visited `v*10 - d*0.15` `30` tries `2` skip `lastTarget<4`, 12-dir scoring `free*(0.55+0.45*dot)` + BFS `>1.8` ou `probe<0.55`, hysteresis `steerX/Z/Cooldown 0.45/0.35` avoids jitter, failsafe `want==0&&dist>0.6` 8 dirs `free>0.5`, anti-blocage `_stuckT>0.55` `bestF>0.35` `1.5-2.5` `canStand` `hasMobGround y/y±1` + pivot `probe<0.15`. TNT: `handleMobExplosion` grid (`R+1.2`) tombe `0.6s` `smoothstep` (`_fallStart/Target` → `PI/2` + `yOff hw*0.9`), reste `3s` couché puis fade `1s` (clonés) et `isMobStandingOn`/`intersectsMob` via `nearbyMobsFor` protège le bloc sous mob et `breakBlock` refuse `isMobStandingOn||intersectsMob`. `generateWorld`/`removeVillagers` clear `visitGrid`/`mobGrid`/`mobById`. **Panique TNT**: `panicVillagers(cx,cy,cz)` appelée dans `handleMobExplosion` quand `dim=="over"` et l'explosion est dans `(VILLAGE_RADIUS+15)²` du `villageCenter` et `abs(cy-villageCenter.y)<=CLOUD_BASE/2`; tous les villageois `homeId>=0` reçoivent `fleeUntil=now+10+stagger` (`stagger=Math.random()*3`, 0–3 s aléatoire par villageois pour étaler la sortie), fuient vers le CENTRE de leur maison (`house.cx+0.5,house.cz+0.5` via `mode="goOut"`+BFS `target=centre`, `WALK*2`), restent `insideT=10s+stagger` dans la maison si à l'intérieur, puis reviennent à `wander` après expiration (les `insideT`/`fleeUntil` décalés font sortir les villageois en file ~3 s au lieu de tous à la fois, évitant l'embouteillage à la porte); pendant la fuite `mobCollidesOther/separateMobs/pushMobsFromPlayer` ignorent parent/enfant et poussent à `0.22`, `fallen` est annulé pour permettre la fuite; bébés ne suivent pas le parent pendant `fleeUntil`. Nether/End sans village ; `removeVillagers`/`spawnVillagers` sur `buildWorld`/`restoreSave`/`resetDims`/`goToDimension` (regen à chaque load), `mobStats` throttled.
- **Mob carry (ENTER)**: press `Enter`/`NumpadEnter` to fire a red grapple (`CARRY_GRAPPLE_CUBES` 2600 `#870000` `0x870000` cube chain `opacity 0.3` + `carryGrappleHead` `0x5a0000` `transparent` `opacity 0.3`) — grab hook flies to mob center (`pos+h/2`) at `GRAPPLE_THROW 70×1.125`=78.75 (+50% dans les 2 sens), homing: `updateCarryGrapple` each tick sets `carryGrappleTarget=mob.pos+h/2` and moves `carryGrappleHookPos` toward it at `1.125` (traverse murs, ignore collision), `carryGrappleCubes` rope follows `hookPos` (not `lerp`) et est rendu à `30%` d'opacité dans les 2 sens (`carryGrappleCubeMat`/`carryGrappleHead.material` `opacity 0.3`/`transparent true`); mob **continue de bouger** (not frozen — `startCarryGrabGrapple` does not touch `vel/path`, `updateMobs`/`separateMobs`/`pushMobsFromPlayer`/`moveAxisX/Z` skip `carryGrappleMob` only when `carryGrapplePulling`, so wander/flee continue pendant la chasse) et l'extrémité ajuste sa trajectoire jusqu'au contact (`dist<=step+hitR`, `hitR=hw+0.35`); pas grave si le mob passe derrière un mur, le hook traverse; dès qu'il touche il ramène **avec le mob** à `78.75` (rope suit `mob.pos+h/2` back to `eye+0.3`) fading `1→0.1` → `0.35` held (`carryMob`, `mode="carried"`), que `Enter` soit encore tenu ou relâché (`handleCarryEnterUp` ne retract plus en `grab`); release when carrying **immediately** detaches and rides outward **from frame 0** (`startCarryReleaseGrapple` `carryGrappleMob=mob,carryMob=null,Pulling=true` at `0.75`, rope follows mob, `0.1→1` puis `releaseCarriedMobAt` et retract à `×0.75`; flat `while(isSolid)h++` `h<=1`→center else face, et **comme le grapin normal** si on pose sur le dessus en visant le bloc en dessous du bloc de surface, la cible glisse vers le bloc de surface: `carryGrappleOrigBlock` mémorisé, `updateCarryGrapple` en mode `release` recalcule `h2` sur `orig` et si `h2<=1` force `Target=orig.x+0.5,topY+1.5`/`Block=topY+1` avant le `pull` — le hook vise le dessus). After any grapple you must release `Enter` and press again (`e.repeat` ignored). `pickMob` ray-AABB unlimited range. While held, `updateCarry` moves mob to `eye+fwd*CARRY_DIST(1.2)-CARRY_DOWN(0.40)-h/2` with `playerArms` visible.
- **Endermen**: ambient teleporters that spawn on the End platform alongside
  the dragon — `ENDERMEN_COUNT` (10) of them, all sharing one unit box
  geometry and body material (`spawnEndermen`/`removeEndermen`, one glowing
  purple `MeshBasicMaterial` eye material each). Each is a tall (2.7-block)
  slender black humanoid: two long legs, a torso, a head with two glowing
  purple eyes and two long arms that hang
  down past the legs (`makeEndermanMesh`). They stand still facing the player,
  gently swaying their arms and bobbing, and teleport constantly:
  - They wander — every `teleportT` (4–10 s) each blinks away to a random clear
    spot on the platform (`endermanPickSpot`, keeps inside radius 20, avoids
    the return portal region, blocks and other endermen).
  - Back off by teleporting if the player gets within 2.5 blocks (walks into
    one).
  - Classic "don't stare" behaviour: holding the crosshair on one for >0.35 s
    (look cone via `camera.getWorldDirection`) angers it — it teleports behind
    the player (a `sin/cos(yaw)` offset) and shakes its arms with
    hot-pink eyes for `ENDERMAN_ANGRY_TIME` (4 s), then teleports away and
    calms. Teleports are telegraphed by a small purple particle burst at both
    the source and destination positions (`spawnEndermanBurst`, reusing the
    `bursts` effect system). Deleted with the dragon when leaving the End /
    resetting dims; spawned fresh every End entry.
- **Save/load**: binary format (`SAVE_MAGIC`, version 8) capturing world
  blocks (over/end/nether), dim, seeds (over/end/nether), player pos/yaw/pitch,
  fly state (the free-cam `freeCam` flag — restored on Load Save only when it
  was enabled upon save, so you resume flying where you saved;
  new worlds always start grounded (New World resets `freeCam`); saves from the old
  dead `flying` variable read as false), hotbar selection,
  placed-flowers' stored color/rotation (`placedFlowers`) and per-glowstone
  colour entries (`glowVariants`, one per dimension, in v7); extra per-entry byte
  pair for flowers in v3, the nether dim/seed/blocks added in v4; older v1/v2/v3
  saves still load, and v5 saves from the briefly-lived torch era are tolerated
  and read past their torch entries. Saves older than v7 have their glowstone
  colours backfilled (clustered) on load, and v6 saves' stored seven-colour
  indices are remapped onto the six via `LEGACY_GLOW_MAP`.
  Backends: File System Access API (`pickSaveFile`/`saveToFile`) and the
  server API (`apiLoad`/`apiList`) — world saves always go to disk (a `.sav`
  file in `save/` via the server, or a user-picked file via the FS Access
  API); nothing is ever kept in browser storage except the remembered
  save-directory handle (`getSaveDir`/IDB key `savedir`). Autosave
  runs every 3 s while the world is dirty (plus on pause/Escape and on page
  hide), via `queueSave()` / the 3-second timer; world regen resets to new
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
- Do not add code comments unless the surrounding code already explains itself.

## Workflow Notes

- The dev server that was restarted during sessions runs on port 8090 via
  `python3 -m http.server`. Prefer `python3 server.py` (port 8383) for normal use.
- Commit messages are single-line, starting with a capital letter, describing
  the user-facing change (e.g. "Increase block reach to 15").
- Always commit changes after completing a task; amend the last commit when
  fixing something just made.
- Always keep AGENTS.md up to date with the project structure and features.
- Instrumentation (puppeteer): Only when the user asks to instrument. Launches `python3 server.py` on 8383, opens `http://127.0.0.1:8383/?test` headless (`headless:'shell'` + `--no-sandbox --disable-gpu`, `NODE_PATH=/Users/q.auge/projects/tech/minicraft/node_modules`), then drives `window._test` (`buildWorld`, `mobs`, `villageHouses`, `villageCenter`, `handleMobExplosion`, etc.) to assert behavior (positions/targets/modes, `fleeUntil` spread, no `PAGEERROR`).
