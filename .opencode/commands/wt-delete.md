---
description: Delete a minicraft worktree workspace
---

Delete workspace `$1` (`$1` = workspace name, required). From the main checkout, run:

1. Kill the worktree server if running (started by `/wt-add`, port in `/tmp/minicraft-$1.port`):
   `PORT=$(cat /tmp/minicraft-$1.port 2>/dev/null); if [ -n "$PORT" ]; then lsof -ti :$PORT | xargs kill 2>/dev/null || true; fi; rm -f /tmp/minicraft-$1.port /tmp/minicraft-$1.log`
2. `git worktree remove --force ../minicraft_wts/$1 && git branch -D $1`
