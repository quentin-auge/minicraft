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
  rivers (`generateRivers`, seeded winding paths) cut 8–14 wide channels down to `RIVER_BED = 8` through the land. Terrain is dramatic
  (`LAND_RAISE = 20`, strong low-freq hills + per-column rough, tops clamped
  at 70, height stdev ~10) with scattered flat-topped mesas: where a low-freq
  `plat` noise sits near its midline the column height snaps to one of ~7
  discrete levels (`8 + lvl*44`, in `heightAt`). Trees range from stumps to
  towering pines (trunk 1–100, roughly half as many of them, clamped to the
  world ceiling `MAX_Y = 120`, via `hash2` in `growTree`). Trees clump into
  forests: a quantile forest noise (`forestThresh`) splits the map ~50/50, with
  1.5x tree density in forests and 0.5x in the sparse rest.
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
  (non-solid, animated opacity), TNT, PORTAL, and ENDSTONE (grey End platform
  block, `placeable: false` so it can't be selected or placed).
- **Player**: AABB collision, gravity, jump, walk/sprint, fly mode, swimming,
  free-cam (spectator). Third-person-style first-person camera, yaw/pitch.
- **Editing**: pointer-raycast block pick (DDA), infinite reach (`REACH`), white
  `highlight` box on the targeted block. Left click places, right click breaks.
- **Grappling hook**: hold middle mouse click on the targeted block to fire a
  hook that first flies fast to the target (`GRAPPLE_THROW = 70`, you don't
  move yet), then hauls you in a straight line onto that block
  (`GRAPPLE_SPEED = 26`, feet on its top, zeroed velocity); releasing mid-pull
  drops you straight down. The pull clips through terrain and only checks the
  landing pose, so low ledges are grabbable too; a thin pixelated rope (cube
  chain ~1/10 block, dense over the whole path) plus a blocky hook head shows
  the pull from the eye to the flying/stuck hook.
- **TNT**: lighting fuses (HUD fuse sprite), delayed explosions with blocks
  destroyed/tossed and particle flashes. Breaking a TNT lights a 3s fuse and
  explosions chain-react: a blast near another TNT block lights it, and a lit
  TNT caught in a blast (or re-broken) detonates immediately. In the End, a
  lit TNT targets the Ender Dragon: the TNT cube flies up at it, sticks onto
  its body and detonates on contact with a big purple particle burst (each
  stuck blast = 1/4 of its HP; blasts merely near it deal 1/4 down to a
  minimum 1/10 by distance).
- **Portals / dimensions**: build a horizontal 5×5 frame in the Overworld
  (4 sides, corners optional), walk into its 3×3 interior to jump to the End;
  solid black fill marks an active portal. The End is freshly regenerated on
  every entry — builds are not kept, the dragon respawns at full health and
  the vertical 5×5 return portal (upright frame, same black-fill core) is
  absent until the Ender Dragon is slain, then appears on the platform to get
  back to the Overworld. Returning drops you beside the Overworld portal
  (never on it), flying is forbidden in the End, and free-cam (F) is disabled
  there; you land just short of the return portal (cooldown + zeroed movement
  prevent an instant round-trip).
- **Ender Dragon**: ambient dragon that spawns in the End and flies along a
  random closed aerial path (arc-length-sampled Catmull-Rom spline through
  random waypoints, low "skim the floor" runs and high soars (about twice the
  platform height), banking turns and dives), re-picking a fresh trajectory
  each lap; its loops alternate tight inner passes and wide sweeps that span
  the whole platform. It tends to come at the player: most loops route a
  waypoint over/near them and every few seconds it does a dive that swoops
  toward and past their position. Its path stays clamped above the platform
  surface and inside its footprint, so it never clips through the platform. Built from Three.js primitives only — boxy, cubic
  style: a blocky torso/belly, box horns and five head spikes, glowing purple
  eyes (unlit), translucent purple bat-wing membranes (mirrored), and
  segmented forked tail boxes; shared geometries/materials. It breathes a
  long-reaching spray of fading purple cube fire from its mouth (about 3x the
  platform reach) — mostly while diving at the player (~60% of dives), with
  occasional level-flight breaths in between. Its flight has small random
  speed bursts (surge) with slightly faster wing flaps. Animated via
  spline-driven yaw/pitch/bank orientation, wing flap with speed, neck/head
  sway, tail wave and body bob. It has a boss health bar (HUD) and can be
  killed with TNT blasts (see TNT). Death triggers a huge double-layer purple
  explosion, opens the return portal and removes the dragon. Resources are
  disposed when leaving the End.
- **Save/load**: binary format (`SAVE_MAGIC`, version 2) capturing world
  blocks, dim, seeds, player pos/yaw/pitch, fly state, hotbar selection.
  Backends: File System Access API (`pickSaveFile`/`saveToFile`),
  IndexedDB fallback, and the server API (`apiLoad`/`apiList`). Autosave
  via `queueSave()`, world regen resets to new seeds (`regenerate`).
- **HUD/UI**: crosshair, hotbar with slot icons (wheel selects), dimension
  label, toasts, autosave indicator; pause overlay (Resume/New
  World/Load Save) and H help panel (`portalArt` diagram).

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