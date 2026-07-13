#!/usr/bin/env bash
# PostToolUse formatter dispatcher. Reads the hook's stdin JSON, extracts the
# edited file path, and runs the right formatter by extension:
#   *.py         -> ruff format   (venv)
#   *.js/.jsx    -> prettier       (frontend/, single-quote + no-semi via .prettierrc)
# Formats ONLY the edited file, so per-task diffs stay minimal. Always exits 0 —
# a formatter hiccup must never block an edit.
set -u
REPO="/c/Users/chissman/issei/.claude/worktrees/craft-d"
PY="/c/Users/chissman/issei/venv/Scripts/python"
export PATH="$PATH:/c/Program Files/nodejs"

# Extract file_path from the hook JSON on stdin (no jq available -> use python).
f="$("$PY" -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path") or d.get("tool_response",{}).get("filePath") or "")' 2>/dev/null)"
[ -z "$f" ] && exit 0
[ -f "$f" ] || exit 0

case "$f" in
  *.py)
    "$PY" -m ruff format "$f" >/dev/null 2>&1 || true
    ;;
  *.js|*.jsx)
    ( cd "$REPO/frontend" && npx prettier --write "$f" >/dev/null 2>&1 ) || true
    ;;
esac
exit 0
