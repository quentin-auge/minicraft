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
  and an End dimension (grey END_STONE floating platform, black sky). Seeded
  (`seed`/`endSeed`), both persisted in saves.
- **Textures**: 16×16 pixel-art textures drawn procedurally on canvas
  (`TEX`, `makeTex`, `pxNoise`, `canvasTex`), NearestFilter + sRGB.
- **Rendering**: one `InstancedMesh` per block type (`instanced` in
  `rebuildMeshes()`), only exposed faces meshed. No shadow maps; fog +
  hemisphere/directional light.
- **Blocks**: numeric constants + `BLOCK_INFO` (solid/opaque/placeable).
  Types incl. GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANKS, GLASS, WATER
  (non-solid, animated opacity), TNT, PORTAL, and ENDSTONE (grey End platform
  block, `placeable: false` so it can't be selected or placed).
- **Player**: AABB collision, gravity, jump, walk/sprint, fly mode, swimming,
  free-cam (spectator). Third-person-style first-person camera, yaw/pitch.
- **Editing**: pointer-raycast block pick (DDA), reach `REACH = 15`, white
  `highlight` box on the targeted block. Left click places, right click breaks.
- **TNT**: lighting fuses (HUD fuse sprite), delayed explosions with blocks
  destroyed/tossed and particle flashes.
- **Portals / dimensions**: build a horizontal 5×5 frame in the Overworld
  (4 sides, corners optional), walk into its 3×3 interior to jump to the End;
  solid black fill marks an active portal. The End has a grey END_STONE
  platform and black sky; a vertical 5×5 return portal (upright frame, same
  black-fill core) is auto-built on the platform to get back to the
  Overworld. Returning drops you beside the Overworld portal (never on it),
  flying is forbidden in the End, and free-cam (F) is disabled there; you
  land just short of the return portal (cooldown + zeroed movement prevent an
  instant round-trip).
- **Ender Dragon**: ambient dragon that spawns in the End and wanders randomly
  over the platform (target waypoints, banking turns). Built from Three.js
  primitives only — black scaled body, segmented neck and head with glowing
  purple eyes (unlit), crest plate and horns, translucent purple bat-wing
  membranes (mirrored), and a segmented forked tail; shared geometries/
  materials. Animated via body bob, neck/head sway, tail wave and wing flap.
  Purely decorative — no HP bar or boss fight. Resources are disposed when
  leaving the End.
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
- Geometry is rebuilt manually — there is no world meshing framework. Changes
  to blocks must call `rebuildMeshes()` and `queueSave()`.
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