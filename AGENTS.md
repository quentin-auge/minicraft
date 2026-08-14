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
  (non-solid, animated opacity), TNT, FLOWER (decorative non-solid, built from
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
  new color — multicolor included) and present in the hotbar between Water and
  TNT with a `TEX.flower` icon), PORTAL, ENDSTONE (grey End platform block,
  `placeable: false` so it can't be selected or placed), CLOUD (solid white
  climbable cloud block, generated by `generateClouds`, `placeable: false`).
- **Player**: AABB collision, gravity, jump, walk/sprint, fly mode, swimming,
  free-cam (spectator). Third-person-style first-person camera, yaw/pitch.
- **Editing**: pointer-raycast block pick (DDA), infinite reach (`REACH`), white
  `highlight` box on the targeted block. Left click places, right click breaks.
- **Grappling hook**: hold middle mouse click on the targeted block to fire a
  hook that first flies fast to the target (`GRAPPLE_THROW = 70`, while it
  flies you keep full control — you keep falling and moving, the rope follows
  you), then hauls you in a straight line onto that block
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
  `winOk`/`vWinOk` for End frames,
  `findEndWinNear` scans both and picks the nearest window).
  End portals can be a flat 5×5 ring (4 sides, corners optional) or a vertical
  5×5/5×4 panel, both with black air interior plus solid black fill when
  active; walk into their 3×3 interior to jump to the End. The End is freshly
  regenerated on every entry — builds are not kept, the dragon respawns at full
  health and the vertical 5×5 return portal (upright frame, `buildReturnPortal`)
  is always standing on the platform but the End is sealed until the dragon dies:
  while the Ender Dragon is alive (`endCleared = false`, set on every End entry)
  every portal out of the End — the return portal's black core and any user-built
  End frame — is dormant (no black
  fill, no teleport; a toast notes the End is sealed), so you cannot leave the
  End to the Overworld until the dragon is defeated. Slaying the
  dragon (`endCleared = true`, set in the death sequence) makes the End-frame
  exits live: the return portal's fill appears and drops you back
  beside the Overworld portal you entered. You can
  build your own End-frame return portal in either orientation. The return
  portal's frame blocks are indestructible (`protectedBlocks`, checked by
  `breakBlock` and the TNT blast loop). Returning drops you beside the
  Overworld portal (never on it), flying is forbidden in the End, and free-cam
  (F) is disabled there; you land just short of the return portal (cooldown +
  zeroed movement prevent an instant round-trip).
  Every valid portal frame — not just the nearest — gets its own persistent
  fill group in a `portalFills`
  Map (`collectEndWins` return all windows in a radius; `scanWorldPortals`
  registers the whole world, `refreshPortalFills` re-validates frames each
  tick and prunes broken ones; portal scans are memoized per cell
  (`portalMemo`) and any `setBlock` edit clears those memos, so a
  frame built while the player stands still inside its future interior is
  recognized immediately). Fills share one `portalFillGeo`
  and a black `MeshBasicMaterial`
  with a per-orientation `layoutPortalFill`; the black glow marks an
  active portal. Fills render as per-cube `Mesh`s in a `THREE.Group` and are
  culled per-frame: hidden when you're in another dimension, when beyond
  `PORTAL_FILL_DIST` (scales with render distance: 8 chunks × 16 × √2 ≈ 182
  blocks, so the glow stays lit as far as the frame itself is visible, plus
  squared-distance test from the eye), or
  when off-view/behind the camera (three.js frustum culling on each cube).
  Portals work both ways, so the End's auto-built return portal brings you
  back to the Overworld's last portal entry point. Any overworld portal entry
  records the exact frame you stepped through
  (`overPortalSpawn` = a clear solid spot ~6–9 blocks in front of it,
  `overPortalFace` = the yaw facing its interior), so the portal you use to
  leave the Overworld is always the spot you land at on the way back.
  The single exception is the End itself while the dragon is alive: `checkPortal`
  checks `endCleared` before any exit, and `refreshPortalFills` clears the
  End's own fills until `endCleared`, so in the End every frame
  stays unlit and sealed until the Ender Dragon is defeated.
  Arriving in the End spawns
  you in front of the auto-built return portal with your back turned to it
  (`yaw = 0`, facing out into
  the new dimension). The End regenerates on
  every entry.
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
- **Save/load**: binary format (`SAVE_MAGIC`, version 3) capturing world
  blocks (over/end), dim, seeds (over/end), player pos/yaw/pitch,
  fly state, hotbar selection, and
  placed-flowers' stored color/rotation (`placedFlowers`; extra per-entry byte
  pair in v3, older v1/v2 saves still load).
  Backends: File System Access API (`pickSaveFile`/`saveToFile`),
  IndexedDB fallback, and the server API (`apiLoad`/`apiList`). Autosave
  via `queueSave()`, world regen resets to new seeds (`regenerate`).
- **HUD/UI**: crosshair, hotbar with slot icons (wheel selects), dimension
  label, toasts, autosave indicator; pause overlay (Resume/New
  World/Load Save) and H help panel (portal diagram: `portalArt` for the
  horizontal End frame).
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