# AGENTS.md

@ARCHITECTURE.md

## Project

MiniCraft — a Minecraft-style game that runs in the browser.

## Commands

No run, build, lint, or test commands configured yet — extend this section as the rewrite grows.

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
- In worktrees, commit normally after each task (`git add -u`, single-line message, capital first letter).

## Workflow Notes

- Commit messages must be single-line (no body, no multi-line text), starting with a capital letter describing the user-facing change.
- Commit changes after completing a task
- If the change is a quickfix of last commit in current session, amend it; ask the user if it is okay, unless the user already specified it
- Keep ARCHITECTURE.md up to date as the rewrite grows
- After changing JS, syntax-check it (`node --check`, on a `.mjs` copy when the file uses ESM `import`) and verify in the browser before committing.
- Do not run instrumentation (puppeteer), verification scripts, or tests unless explicitly requested by the user.
