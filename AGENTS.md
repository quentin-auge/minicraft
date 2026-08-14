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
  boss bar, toast, autosave status), the Three.js import map.
- `main.js` — all game logic in one ES module, organized in sections:
  block definitions → procedural textures → world gen → renderer →
  instanced meshing → player physics → raycast/highlight → editing →
  TNT → portal/dimensions → Ender Dragon → save/load → HUD → hotbar →
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
  randomly picks water size 1–4 (basin frequency ∝ 1/√scale) and depth 1–4
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
  and extends 3x max tree height high (`CLOUD_LAYER`, top ≤ 254 = `MAX_Y`).
- **Textures**: 16×16 pixel-art textures drawn procedurally on canvas
  (`TEX`, `makeTex`, `pxNoise`, `canvasTex`), NearestFilter + sRGB.
- **Rendering**: chunked streaming. The overworld is split into `CHUNK` (16)×
  16-column chunks and only the square of chunks within `RENDER_DIST` (8) of
  the player are meshed (added/removed as you cross chunk borders in
  `streamChunks()`/`rebuildChunk`). Each chunk is one `InstancedMesh` per
  block type with only exposed faces; every mesh calls `computeBoundingSphere()`
  so Three.js frustum-culls off-screen chunks. Shared per-type materials
  (`typeMats`). Editing rebuilds just the touched chunk(s) via
  `refreshBlocks()`, not the whole world. No shadow maps; fog +
  hemisphere/directional light.
- **Blocks**: numeric constants + `BLOCK_INFO` (solid/opaque/placeable).
  Types incl. GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANKS, GLASS, WATER
  (non-solid, animated opacity; WATER and BLUEFIRE are placeable only
  onto a cell already holding the same liquid — water on water, blue
  fire on blue fire — and nothing else can be placed into a liquid cell
  or stacked directly on a liquid surface;
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
  OBSIDIAN (dark purple-black rock from the Nether, in the hotbar after the
  Portal block, `placeable: true`, used as the mandatory frame of the 5×4
  Nether portal), BLUEFIRE (glowing blue-fire liquid, unlit `MeshBasicMaterial`
  face materials whose color shimmers in the main loop, `placeable: true` so it
  can sit in the hotbar and be placed in the Nether/End),
  NETHERRACK (dark blue Nether rock, in the hotbar after OBSIDIAN,
  `placeable: true`), SOULSAND (dark blue-grey Nether beach block,
  `placeable: false`), GLOWSTONE (glowing ice-blue Nether block rendered unlit via
  `basicFace` so it shines, `placeable: false`),
  GREENSTONE (the green portal block: solid, `placeable: true`, in the hotbar,
  drawn unlit via `basicFace` like glowstone so it shines at full strength no
  matter how far you stand from it, and it casts a steady pool of green light:
  greenstones are merged into stable clusters (`recomputeGreenClusters`, a whole
  6×6 volcano door ring shares one cluster) whose centroids are recomputed only
  when blocks change, and a fixed pool of green `PointLight`s
  (`syncGreenLights`/`clearGreenLights`, `GREEN_LIGHT_MAX` 16, intensity 60,
  `distance: 12`, decay 1) is assigned to the clusters nearest the player — the
  assignment re-evaluates at most every `GREEN_LIGHT_REFRESH` (0.5 s) and only
  when the player crosses a chunk, and each light keeps its current cluster
  while that cluster stays among the nearest lit ones, so the glow never jumps
  between the stones of a ring, never flickers while you walk toward a cluster,
  and costs nothing in between (no per-frame world scan) —
  and it replaces FLOWER in the
  Nether/End hotbar; volcano door frames are built from it so tunnel mouths
  also glow).
  The **hotbar is dimension-aware** (`hotbarList`/`rebuildHotbar`): in the
  Nether and the End the Flower slot holds GREENSTONE and the Water slot holds
  BLUEFIRE, while the Overworld keeps flowers and water; the hotbar is rebuilt
  on every dimension change, load and new world.)
- **Player**: AABB collision, gravity, jump, walk/sprint, fly mode, swimming,
  free-cam (spectator). Third-person-style first-person camera, yaw/pitch.
  Auto-steps are smooth: walking into a 1-block step auto-jumps (a tight
  `AUTO_JUMP` hop when the touched block is exactly one high and clear —
  `tryStep` inspects the actual cell the footprint hits, so corners climb
  cleanly without deviating the line of travel; it only fires while on the
  ground and moving into the block), and walking off a
  1-block ledge glides down at constant `STEP_SPEED` instead of free-falling
  (`stepDown` triggers only when the ground was solid the previous frame and is
  exactly one block below — jumps and tall drops keep normal gravity).
- **Editing**: pointer-raycast block pick (DDA), infinite reach (`REACH`), white
  `highlight` box on the targeted block. Left click places, right click breaks.
- **Grappling hook**: hold middle mouse click on the targeted block to fire a
  hook that first flies fast to the target (`GRAPPLE_THROW = 70`, while it
  flies you keep full control — you keep falling and moving, the rope follows
  you; the hook flies straight through water and blue fire — it never grabs a
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
  hook.
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
  active; walk into their 3×3 interior to jump to the End. The End is freshly
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
  wall, floating, or standing in another frame), flying is forbidden in the
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
- **The Nether**: a hostile third dimension under an orange/red/blue sky — a
  big back-side sky dome (`skyDome`, follows the camera so the horizon never
  moves, `fog: false` so it stays clear past the fog; deep blue zenith with
  stars, red band, burning orange horizon, dark smoky below eye level) with a
  glowing sun disc (`netherSun`, orbits slowly as the dome rotates), plus
  `setDimensionEnv` warm-orange sun light, blue-ish hemisphere fill and dark
  smoky purple fog. Rock mountains (`generateNether`, fbm height ~12–84) rise
  out of a glowing blue-fire sea (`NETHER_FIRE_LEVEL`) where the old lava sea
  used to be (the block id 16 stays the same, so saves keep loading; it's just
  re-skinned and renamed Blue Fire). Winding canyons (`generateNetherRivers`/
  `nearestNetherRiver`) are carved down to the fire so they fill as blue-fire
  rivers, and steep cliffs that drop into the sea get vertical blue-fire
  streaks pouring down their faces. Immense fire-spewing volcanoes
  (`generateVolcanoes`/`volcanoHeightAt`, 2–3 per world placed far from spawn
  with a spawn clearance that scales with each cone's radius, radius 70–85 —
  bases span ~the whole 193-block world, plateau rim at `peak * 0.85` with
  peak 260–284, crater
  radius 5–10 and depth 14–28) tower up to ~240 blocks, right under the
  world ceiling: each is a truncated
  cone of NETHERRACK with a flat plateau whose centre is cut into a bowl
  (`fillVolcanoCraters`) filled with BLUEFIRE up to the rim, so every crater
  reads as a glowing fire lake. A central BLUEFIRE shaft (`fillVolcanoShafts`)
  as wide as the crater (`craterR`) runs up the middle of each volcano from
  the ground base (`baseY`) all the way to the crater, a big swimmable lava
  chimney. Ten straight 4×4 tunnels (`volcanoTunnels`, spaced 36° apart) are
  dug dead-straight in to the lava shaft from mouths spread across every height
  of the cone — each tunnel gets its own level, interleaved via `(k*7) % 10`
  between `baseY + 6` and `rim * 0.8` so neighbouring tunnels are never at the
  same height, and every mouth bores horizontally to the fire column. Each mouth
  sits at the outermost point on its heading where the flank clears the doorway
  (`dOut` scan via `volcanoHeightAt`, threshold `hT + 5`) so the bore stays
  buried in rock, the volcano surface is flattened into a level apron
  (`plat + 1 .. plat + 6` carved from `dOut+1` for 8 blocks) so the entrance
  reads square, and every opening is closed with a strict 6×6 GREENSTONE (block
  id 20, unlit `basicFace` bright-green pixel texture so it shines) square ring
  (1 block thick, 4×4 hole) pressed against the flank. Tunnels carve
  NETHERRACK/SOULSAND/BLUEFIRE and generation runs
  `volcanoCascades` before `volcanoTunnels`, so coulees never refill a tunnel.
  Each volcano spills a broad main plus a
  narrower side lava coulee over the rim that runs all the way down its
  flank to the base (`volcanoCascades`, angular courses deepest near the rim
  where they burst out, up to 9 blocks thick, thinning and widening downhill
  into uneven tongues), and a constant eruption fountain
  (`updateVolcanoEmbers`/`spawnVolcanoEmber`, ~340 additive `THREE.Points`
  launched up out of the crater fire, arcing and splashing back down; torn
  down on leaving the Nether). Everything in the Nether is dark blue: terrain
  is NETHERRACK (dark blue rock, placeable, in the hotbar) instead of plain
  STONE; the top block of columns just at the fire line is dark blue-grey
  SOULSAND, giving the sea a grim black beach; rare columns carry a glowing
  knotted cluster of ice-blue GLOWSTONE at
  their summit (plus one floating lump above; the GLOWSTONE texture is drawn
  with cold white-blue spots and rendered unlit via `basicFace` so it shines in the
  dark), and `setDimensionEnv` uses cool blue-white sun light with dark blue
  fog so the whole dimension reads blue. Rising blue embers (`updateNetherEmbers`/`ensureEmbers`, ~220 additive
  `THREE.Points` spawned only over the fire sea, drifting upward with a sway,
  fading
  and respawning every ~2–5 s; torn down on leaving the Nether) float up off
  the blue-fire sea all around you. BLUEFIRE behaves like water: you auto-float
  to the
  surface (`headInWater` treats BLUEFIRE like WATER, and both are non-solid so
  you can wade in from any direction; base float speed `FLOAT_SPEED` 1.8,
  and holding Space swims up faster the deeper you are — `SWIM_SPEED` 4.0
  scaled +20% per 10 blocks below the surface via `waterSurfaceTop`, capped at
  `SWIM_MAX` = 100× base, so the bonus only applies while Space is held and
  releasing Space drops you back to float speed immediately), BLUEFIRE
  is placeable only onto another BLUEFIRE cell or directly on the fire above one,
  can't be removed, and TNT blasts never destroy
  BLUEFIRE. The Nether's auto-built return portal (`buildNetherPortal`, an obsidian
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
- **Save/load**: binary format (`SAVE_MAGIC`, version 4) capturing world
  blocks (over/end/nether), dim, seeds (over/end/nether), player pos/yaw/pitch,
  fly state, hotbar selection,
  placed-flowers' stored color/rotation (`placedFlowers`; extra per-entry byte
  pair in v3, the nether dim/seed/blocks added in v4; older v1/v2/v3 saves still
  load, and v5 saves from the briefly-lived torch era are tolerated and read
  past their torch entries).
  Backends: File System Access API (`pickSaveFile`/`saveToFile`),
  IndexedDB fallback, and the server API (`apiLoad`/`apiList`). Autosave
  via `queueSave()`, world regen resets to new seeds (`regenerate`).
- **HUD/UI**: crosshair, hotbar with slot icons (wheel selects), dimension
  label, toasts, autosave indicator; pause overlay (Resume/New
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