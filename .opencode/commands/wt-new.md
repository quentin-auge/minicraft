---
description: Create a minicraft worktree workspace from a commit, serve it on a random port
---

Create a new workspace from arguments `$ARGUMENTS` (`$1` = workspace name, required; `$2` = base commit, default `master`).

1. Validate: `$1` must be non-empty and match `[A-Za-z0-9._-]+`. Fail otherwise.
   Resolve base as `$2` if given, else `master`; verify with `git rev-parse --verify <base>`. Fail if unknown.
2. Fail if `../minicraft_wts/$1` already exists (never overwrite).
3. From the main checkout, run:
   `git worktree add ../minicraft_wts/$1 -b $1 <base>`
4. If running inside tmux (`[ -n "$TMUX" ]`), rename the session:
   `tmux rename-session $1`
   Skip silently when not in tmux.
5. Pick a free port (OS-assigned, so it never clashes with 8383 or other worktrees):
   `python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1])"`
6. Start the server in the background with workdir `../minicraft_wts/$1`:
   `PORT=<port> nohup python3 server.py > /tmp/minicraft-$1.log 2>&1 &`
   Record the port in `/tmp/minicraft-$1.port`.
7. Announce loudly (banner, not buried prose): worktree path, branch, base commit, `http://localhost:<port>/`, log path.
   Note the agent works on the absolute worktree path directly — no session relocation needed.
