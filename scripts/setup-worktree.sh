#!/usr/bin/env bash
#
# Bring a fresh worktree or cloud container to a state where an agent can check its own work.
# Wired into t3code as the project's run-on-worktree-create script, run by the dispatch and
# PR review workflows, and the command to give a cloud agent environment as its setup script.
# Safe to re-run by hand at any time.
#
# Why not plain `pnpm install`: t3code launches scripts from a shell that has not run mise's
# prompt hook, so the repo's Node 24 pin loses to whatever Node the parent shell had (see
# CLAUDE.md, "Run everything on Node 24"), and a host without mise has no Vale at all.
# scripts/install-tools.sh resolves both, installing them without root where mise is absent.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

log() { echo "[setup-worktree] $*"; }

tools_status=0
tool_path="$(bash scripts/install-tools.sh)" || tools_status=$?
if [ -n "$tool_path" ]; then
  export PATH="$tool_path:$PATH"
  # Later steps of an Actions job, the agent's own included, read their PATH from this file.
  if [ -n "${GITHUB_PATH:-}" ]; then tr ':' '\n' <<<"$tool_path" >>"$GITHUB_PATH"; fi
  log "tools on PATH: $tool_path"
fi

node_major="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$node_major" != "24" ]; then
  log "ERROR: node ${node_major:-missing} on PATH; this repo pins Node 24 (.nvmrc, .mise.toml)."
  log "       scripts/install-tools.sh could not install it; its log is above."
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

# These come from the system package manager, which needs root, so they are reported, not
# installed. Preflight's coverage step requires jq and OpenSSL; the posting skills use gh.
for tool in git jq openssl gh; do
  command -v "$tool" >/dev/null 2>&1 || log "WARNING: $tool is not on PATH; install it with the system package manager."
done

# The edit hook (.claude/hooks/vale-prose.sh) passes without Vale, so a missing binary is an
# error here: it is the only point where the hook's absence is visible. On an Actions runner,
# review fires read the install log by hand after this exit to learn the tree was usable, so
# there it is a warning.
if [ "$tools_status" != 0 ] || ! command -v vale >/dev/null 2>&1; then
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    log "WARNING: Vale or its Google style is missing; the prose hook cannot run. Dependencies installed; the tree is usable."
    log "ready"
    exit 0
  fi
  log "ERROR: Vale or its Google style is missing; the prose hook cannot run. scripts/install-tools.sh logged why above."
  exit 1
fi
log "vale $(vale --version | sed -E 's/^vale version //')"

log "ready"
