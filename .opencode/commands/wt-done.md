---
description: Rebase worktree onto its parent branch, merge, and delete the workspace
---

Finish the workspace. Run inside the worktree.

1. Guard: cwd must be under `minicraft_wts/` and the current branch must not be `master`/`main`. Stop otherwise.
   (The parent branch `BASE` is resolved in step 3; step 1 also stops if the workspace branch equals `BASE` once known.)
2. Stop if dirty: check `git status --short`; if it shows anything, stop and tell the user
   to commit or stash first. Never stage or commit anything yourself.
3. Record the workspace identity plus both tips before touching anything:
   `WT=$(git rev-parse --show-toplevel)`, `BRANCH=$(git rev-parse --abbrev-ref HEAD)`
   (the branch is the workspace name, created by `/wt-add` with `-b $1`),
   resolve the parent branch `BASE=$(cat /tmp/minicraft-$BRANCH.base 2>/dev/null)`
   (recorded by `/wt-add`; when absent, fall back to the branch checked out in `$MAIN` — resolve `$MAIN` per step 6 first in that case),
   then `git rev-parse BASE` → `$OLD_BASE`, `git rev-parse HEAD` → `$OLD_BRANCH`.
   Stop if `$BRANCH` equals `BASE`. Print all five.
4. Run `git rebase BASE --exec "<js-check>"` (local base, no fetch), where `<js-check>` is:
   `cp main.js /tmp/mc-check.mjs && node --check /tmp/mc-check.mjs`
   (copied to /tmp as `.mjs` so node parses it as a module without executing anything).
   It runs automatically after every replayed commit, including after each `rebase --continue` in step 5.
   If the exec check fails at some commit: report which commit broke `main.js` syntax
   and stop with instructions (fix the commit and run `git rebase --continue`,
   or run `git rebase --abort`) — do not fix or continue yourself.
5. If conflicts: for context use ONLY what landed on the base underneath you —
   `git log --oneline $OLD_BASE..BASE` (commit messages) and
   `git diff $OLD_BASE BASE -- AGENTS.md` (AGENTS.md updates in those commits) —
   plus `git diff --name-only --diff-filter=U` for the conflicted files.
   Resolve, `git add` the resolutions, `git rebase --continue`, repeat until clean,
   then step 6 (or `git rebase --abort` to bail out mid-rebase).
6. Main-checkout guard (nothing destructive has happened yet — stopping here leaves the
   rebased worktree intact for a retry):
   `MAIN=$(dirname "$(git rev-parse --git-common-dir)")`; `cd "$MAIN"`.
   Require `git rev-parse --abbrev-ref HEAD` to be `BASE` — else stop and tell the user
   to check out the parent branch in the main checkout first.
   Require a clean tracked tree (`git status --short --untracked-files=no` must be empty;
   untracked files alone never block) — else stop and tell the user to commit or stash there first.
7. Merge: `git merge --ff-only "$BRANCH"`. `--ff-only` fails loudly instead of creating a
   merge commit (e.g. the base moved mid-flight) — on failure stop, report, and leave the
   worktree in place.
8. Delete the workspace (the `/wt-delete` steps, run from `$MAIN`, never from inside `$WT`):
   kill the worktree server if running (started by `/wt-add`, port in `/tmp/minicraft-$BRANCH.port`):
   `PORT=$(cat /tmp/minicraft-$BRANCH.port 2>/dev/null); if [ -n "$PORT" ]; then lsof -ti :$PORT | xargs kill 2>/dev/null || true; fi; rm -f /tmp/minicraft-$BRANCH.port /tmp/minicraft-$BRANCH.log /tmp/minicraft-$BRANCH.base`
   then `git worktree remove --force "$WT" && git branch -D "$BRANCH"`.
9. Announce loudly (banner, not buried prose): merged SHA (`git rev-parse BASE`), removed
    worktree path, deleted branch — plus the rollback line for the user to run themselves
    if the result is faulty (`git -C "$MAIN" reset --hard $OLD_BASE`).
