---
description: Rebase the current worktree onto master
---

Finish the workspace. Run inside the worktree.

1. Guard: cwd must be under `minicraft_wts/` and the current branch must not be `master`/`main`. Stop otherwise.
2. Stop if dirty: check `git status --short`; if it shows anything, stop and tell the user
   to commit or stash first. Never stage or commit anything yourself.
3. Record both tips before touching anything: `git rev-parse master` → `$OLD_MASTER`,
   `git rev-parse HEAD` → `$OLD_BRANCH`. Print both SHAs.
4. Run `git rebase master --exec "<js-check>"` (local master, no fetch), where `<js-check>` is:
   `cp main.js /tmp/mc-check.mjs && node --check /tmp/mc-check.mjs`
   (copied to /tmp as `.mjs` so node parses it as a module without executing anything;
   `package.json` declares commonjs, so checking `main.js` in place would misparse `import`).
   It runs automatically after every replayed commit, including after each `rebase --continue` in step 5.
5. If conflicts: for context use ONLY what landed on master underneath you —
   `git log --oneline $OLD_MASTER..master` (commit messages) and
   `git diff $OLD_MASTER master -- AGENTS.md` (AGENTS.md updates in those commits) —
   plus `git diff --name-only --diff-filter=U` for the conflicted files.
   Resolve, `git add` the resolutions, `git rebase --continue`, repeat until clean,
   then step 6 (or `git rebase --abort` to bail out mid-rebase).
6. If clean: smoke-check with `python3 -m py_compile server.py`, then report success plus
   the merge line — print it for the user to run themselves
   (`git checkout master && git merge --ff-only <branch>`); do not check out master
   or merge yourself. Also print the rollback line
   (`git reset --hard $OLD_BRANCH`, for you to run yourself if the result is faulty).
   Leave the worktree in place.
   If the exec check fails at some commit: report which commit broke `main.js` syntax
   and stop with instructions (fix the commit and run `git rebase --continue`,
   or run `git rebase --abort`) — do not fix or continue yourself.
