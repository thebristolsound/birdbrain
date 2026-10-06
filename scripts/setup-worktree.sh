#!/usr/bin/env bash
#
# Bring a fresh worktree to a working state. Wired into t3code as the project's
# run-on-worktree-create script; safe to re-run by hand at any time.
#
# Why not plain `pnpm install`: t3code launches scripts from a shell that has not
# run mise's prompt hook, so the repo's Node 20 pin loses to whatever Node the
# parent shell had (see CLAUDE.md, "Run everything on Node 20"). Under Node 24
# Electron's postinstall exits 0 with a broken node_modules/electron/dist, so the
# failure only surfaces on the first `pnpm test`. This script pins Node first and
# refuses to continue on the wrong major.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

log() { echo "[setup-worktree] $*"; }

if command -v mise >/dev/null 2>&1; then
  # Installs the pinned tools (.mise.toml): Node, and Vale for the prose hook.
  mise install --quiet 2>/dev/null || log "WARNING: mise install failed; pinned tools may be missing"
  eval "$(mise env -s bash 2>/dev/null || true)"
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$node_major" != "20" ]; then
  log "ERROR: node $(node --version) on PATH; this repo pins Node 20 (.nvmrc, .mise.toml)."
  log "       Install it with 'mise install' and re-run."
  exit 1
fi
log "node $(node --version), pnpm $(pnpm --version)"

pnpm install

if [ ! -d node_modules/electron/dist ]; then
  log "ERROR: node_modules/electron/dist missing after install; Electron postinstall failed."
  exit 1
fi

if [ ! -x node_modules/.bin/commitlint ]; then
  log "ERROR: node_modules/.bin/commitlint missing; the commit-message hook cannot run."
  exit 1
fi

# The edit hook (.claude/hooks/vale-prose.sh) passes without Vale, so a missing binary is
# an error here: it is the only point where the hook's absence is visible.
if ! command -v vale >/dev/null 2>&1; then
  log "ERROR: vale missing; the prose hook cannot run. Install mise (https://mise.jdx.dev) and re-run."
  exit 1
fi
if [ ! -d .vale/styles/Google ]; then
  vale sync || log "WARNING: vale sync failed; prose linting unavailable until it succeeds"
fi
log "vale $(vale --version | sed -E 's/^vale version //')"

log "ready"
