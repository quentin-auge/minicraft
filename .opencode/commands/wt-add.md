---
description: Create a minicraft worktree workspace from a commit, serve it on a random port
---

Create a new workspace from arguments `$ARGUMENTS` (`$1` = workspace name, required; `$2` = base commit, default `master`).

1. Validate: `$1` must be non-empty and match `[A-Za-z0-9._-]+`. Fail otherwise.
   Resolve base as `$2` if given, else `master`; verify with `git rev-parse --verify <base>`. Fail if unknown.
   If running inside tmux (`[ -n "$TMUX" ]` and `[ -n "$TMUX_PANE" ]`), you may capture the originating window ID early, pinned to the originating pane:
   `WID=$(tmux display-message -t "$TMUX_PANE" -p '#{window_id}')`.
   Do not trust this variable across tool calls (each call may run in a fresh shell) — step 4 re-resolves authoritatively. Never use a bare `display-message` without `-t "$TMUX_PANE"` (it returns the active window, which may have changed).
   Skip silently when not in tmux or `$TMUX_PANE` is empty.
2. Fail if `../minicraft_wts/$1` already exists (never overwrite).
   Resolve the absolute worktree path (works from any cwd, including inside a
   worktree): `TOP=$(git rev-parse --show-toplevel); WT="$TOP/../minicraft_wts/$1"`.
3. Run:
   `git worktree add "$WT" -b $1 <base>`
4. If running inside tmux, re-resolve the originating window at rename time (self-contained — never reuse a `$WID` from an earlier call) and rename by ID, so switching the active window mid-run still renames the origin:
   `WID=$(tmux display-message -t "$TMUX_PANE" -p '#{window_id}'); if [ -n "$WID" ]; then tmux rename-window -t "$WID" "$1"; tmux set-window-option -t "$WID" automatic-rename off; tmux display-message -t "$WID" -p '#{window_name}'; else echo "wt-add: warning: could not resolve originating window, skipping rename"; fi`
   Skip silently when not in tmux or `$TMUX_PANE` is empty. `automatic-rename off` keeps the manual name (the host has `automatic-rename on`, which would otherwise overwrite it).
5. Pick a free port (OS-assigned, so it never clashes with 8383 or other worktrees):
   `python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1])"`
6. Start the server in the background with workdir `$WT` (the worktree starts
   with an empty save/ — `save/` is gitignored, never copied):
   `PORT=<port> nohup python3 "$WT/server.py" --save-dir "$WT/save" > /tmp/minicraft-$1.log 2>&1 &`
   Record the port in `/tmp/minicraft-$1.port`.
7. Announce loudly (banner, not buried prose): worktree path, branch, base commit, `http://localhost:<port>/`, log path, save dir (`$WT/save`).
   Note the agent works on the absolute worktree path directly — no session relocation needed.
