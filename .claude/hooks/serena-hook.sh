#!/usr/bin/env bash
# Wrapper for Serena's reminder hooks (remind / activate / cleanup).
# Durability contract: this script must never fail or emit noise. Dispatch
# worktrees and unattended agents run with whatever PATH the harness gives
# them, and a machine without serena installed must behave as if the hook
# does not exist. Missing binary, crash, or hang all end in a silent exit 0.
set -u

sub="${1:-}"
[ -z "$sub" ] && exit 0

bin="$(command -v serena-hooks 2>/dev/null || true)"
if [ -z "$bin" ] && [ -x "${HOME:-}/.local/bin/serena-hooks" ]; then
  bin="${HOME:-}/.local/bin/serena-hooks"
fi
[ -z "$bin" ] && exit 0

if command -v timeout >/dev/null 2>&1; then
  timeout 10 "$bin" "$sub" --client=claude-code 2>/dev/null || true
fi
exit 0
