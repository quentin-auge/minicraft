# AGENTS.md

@ARCHITECTURE.md

## Project

MiniCraft — a Minecraft-style game that runs in the browser.

## Commands

- Serve statically: `python3 -m http.server 8383` (no backend; any static host works, e.g. GitHub Pages).
- Syntax-check JS: copy the file to `/tmp/*.mjs` first when it uses ESM `import`, then `node --check`.
- Headless world-gen check: copy `src/core/*` + `src/world/*` to a temp dir with `{"type":"module"}` and run the seed/houses assertions there (three-free modules only).

## Conventions

- Read @ARCHITECTURE.md before changing code. It describes the codebase tree,
  the data model, the data flow, and the broad logic of each system, plus tuning
  specs and Nether/End extension points. Update it whenever code changes:
  new/removed files, systems, features, entities, constants.
- Every source file in the repo (`index.html`, `main.js`, everything under
  `src/`) must be listed in ARCHITECTURE.md's Tree section with its
  responsibility; adding a file without documenting it there is
  incomplete work.
- ARCHITECTURE.md describes the code as it stands at every commit, not just
  at the tip: when amending or rebasing history, update it in the same commit.
  Refactor its sections freely (merge, split, reorder, reword) to keep the
  document compact, complete, and free of anything outdated.
- Before adding requested behavior, refactor the existing structure into a
  generic form when one fits, and add the request as a specialization of it;
  keep modules extension-ready (new tree types, hook kinds, flower variants,
  particle effects) rather than one-off code.
- Follow the extension conventions named in ARCHITECTURE.md (spec
  registries, capability flags, registry dispatch, stable keys) for every
  variant family, present or future.
- Plain ES modules; Three.js is loaded from CDN via the import map in `index.html`. Do not add new CDN/addons dependencies unless requested.
- Keep code comments to what needs explanation to guide the agent; avoid restating what the code already shows.
- All code, comments, and documentation must be written in English — no French anywhere.

## Worktrees

- Workspaces live in `../minicraft_wts/<name>` (one dir = one branch of the same name); each server uses its own random port from `/tmp/minicraft-<name>.port`.
- Natural language routing: "spawn/create a new workspace ..." → follow `.opencode/commands/wt-add.md` with that name/commit (forks the current branch by default); "rebase onto parent / finish this workspace ..." → follow `.opencode/commands/wt-done.md` (rebases onto the parent branch recorded at creation, merges into it, deletes the workspace); "delete/remove workspace ..." → follow `.opencode/commands/wt-delete.md`.
- In worktrees, commit normally after each task (`git add -u`, plus `git add <file>` for each file created during the task; never blanket `git add -A` / `git add .`, single-line message, capital first letter).

## Workflow Notes

- Commit messages must be single-line (no body, no multi-line text), starting with a capital letter describing the user-facing change.
- Commit changes after completing a task
- Stage with `git add -u`, then `git add <file>` for every new file you created during the task; never `git add -A` / `git add .` (they sweep unwanted untracked files, e.g. TODO.md).
- If the change is an obvious quickfix/iteration of the last commit in the current session, amend with `git commit --amend`; ask the user if it is okay, unless the user already specified it.
- Keep ARCHITECTURE.md up to date as the rewrite grows
- After changing JS, syntax-check it (`node --check`, on a `.mjs` copy when the file uses ESM `import`) and verify in the browser before committing.
- Run the headless suites (`node tests/headless/mobs/*.test.mjs`) systematically as non-regression after every change under `src/`; they are fast and instant by design (see the Tests section in @ARCHITECTURE.md) — keep them that way.
- Run instrumentation (puppeteer, the `?test=1` hook) only when the user explicitly requests it; its purpose is to enrich the existing headless suite with cases it does not cover yet.
