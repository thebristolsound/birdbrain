#!/bin/bash
#
# SessionStart hook.
#
# Remote (Claude Code on the web, CLAUDE_CODE_REMOTE=true): brings a fresh container up
# to the state the agent contracts already assume — Node 20 on PATH, the `gh` CLI,
# and dependencies installed so `pnpm test` and `pnpm lint` run without
# per-session improvisation.
#
# Local: only pins Node. A mise-activated interactive shell bakes its *resolved* tool
# dirs (e.g. installs/node/lts/bin — the global default) into PATH ahead of the shims,
# and Claude Code's non-interactive tool shells inherit that PATH without ever re-running
# mise's prompt hook. The repo's .mise.toml pin therefore silently loses to whatever Node
# the launching shell had active. Prepending the pinned Node here makes the pin win.
#
# Idempotent and non-interactive: safe to re-run, never prompts.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

log() { echo "[session-start] $*"; }

# Persist a line into the session environment. CLAUDE_ENV_FILE is not guaranteed to
# be set (e.g. when this script is run by hand to validate it), hence the guard.
persist_env() {
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "$1" >> "$CLAUDE_ENV_FILE"
  fi
}

# ---------------------------------------------------------------------------
# 0. Refresh git refs — must run before anything else
# ---------------------------------------------------------------------------
# Every agent contract computes its diff base and completion controls against
# origin/main: the implementer's evidence-affecting path gate, the reviewer's
# touched-path backstop and commit-trailer check, and the dispatch skill's
# completion controls. Nothing else in the repo updates that ref — the implementer
# fetches before *pushing*, which is after the base has already been used (#479).
#
# A stale origin/main fails silently: the commands succeed and report a clean
# result computed against an old ref. Because contracts use three-dot
# (origin/main...HEAD) the merge base only moves *earlier*, so the usual outcome
# is extra paths rather than missing ones — but a path that became
# evidence-affecting since the last fetch is matched against a stale include list,
# and that direction is a false negative on the evidence gate.
#
# Refs live on the common .git and are shared by every worktree, so one fetch here
# repairs every concurrent session.
#
# Bounded and never fatal. An unbounded network call at session start is its own
# hang risk, and a session must still start offline — so this warns rather than
# blocks, and the warning names what is no longer trustworthy.
fetch_refs() {
  command -v git >/dev/null 2>&1 || { log "WARNING: git not on PATH; refs not refreshed"; return; }
  git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1 || {
    log "WARNING: $PROJECT_DIR is not a git repo; refs not refreshed"; return; }

  local before after
  before="$(git -C "$PROJECT_DIR" rev-parse --quiet --verify origin/main || echo none)"

  if timeout 30 git -C "$PROJECT_DIR" fetch --prune --quiet origin 2>/dev/null; then
    after="$(git -C "$PROJECT_DIR" rev-parse --quiet --verify origin/main || echo none)"
    if [ "$before" = "$after" ]; then
      log "refs up to date (origin/main ${after:0:8})"
    else
      log "refs updated: origin/main ${before:0:8} -> ${after:0:8}"
    fi
  else
    log "WARNING: git fetch failed or timed out. origin/main is ${before:0:8} and may be stale."
    log "         The evidence-affecting path gate and the reviewer's touched-path"
    log "         backstop are computed against it — re-run 'git fetch --prune origin'"
    log "         before trusting either (#479)."
    return
  fi

  # Fast-forward the local main branch without checking it out, so a prompt that
  # says "diff against main" is not silently working from a stale ref. Refuses
  # harmlessly if main is ever checked out in a worktree, hence the guard.
  if git -C "$PROJECT_DIR" show-ref --quiet --verify refs/heads/main; then
    if ! timeout 30 git -C "$PROJECT_DIR" fetch --quiet origin main:main 2>/dev/null; then
      log "NOTE: local 'main' not fast-forwarded (checked out in a worktree, or diverged)."
      log "      Contracts use origin/main, which is current; bare 'main' may not be."
    fi
  fi
}

fetch_refs

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  # Never fatal: a missing/broken mise must not block local sessions from starting.
  MISE_BIN="$(command -v mise || true)"
  [ -x "${MISE_BIN:-}" ] || MISE_BIN="$HOME/.local/bin/mise"
  if [ -x "$MISE_BIN" ] \
    && NODE_DIR="$(cd "$PROJECT_DIR" && "$MISE_BIN" where node 2>/dev/null)" \
    && [ -x "$NODE_DIR/bin/node" ]; then
    export PATH="$NODE_DIR/bin:$PATH"
    persist_env "export PATH=\"$NODE_DIR/bin:\$PATH\""
    log "node pinned to $("$NODE_DIR/bin/node" --version) via mise"
  else
    log "WARNING: could not resolve the pinned Node via mise; 'node --version' may be wrong for this repo (see CLAUDE.md Node note)"
  fi
  # Same for Vale, which .claude/hooks/vale-prose.sh needs and which passes silently without.
  if [ -x "$MISE_BIN" ] \
    && VALE_DIR="$(cd "$PROJECT_DIR" && "$MISE_BIN" where vale 2>/dev/null)" \
    && [ -x "$VALE_DIR/bin/vale" ]; then
    export PATH="$VALE_DIR/bin:$PATH"
    persist_env "export PATH=\"$VALE_DIR/bin:\$PATH\""
  elif ! command -v vale >/dev/null 2>&1; then
    log "WARNING: vale is not installed; the prose hook will pass every edit. Run 'mise install'."
  fi
  # Measurement only (ADR-0029): how much the teardown skill could reclaim. Bounded, never fatal.
  TEARDOWN="$PROJECT_DIR/.claude/skills/teardown/scripts/teardown.sh"
  if [ -x "$TEARDOWN" ]; then
    (cd "$PROJECT_DIR" && timeout 15 "$TEARDOWN" sweep --count 2>/dev/null) || log "teardown count skipped (timed out or failed)"
  fi
  # A t3code worktree gets dependencies from scripts/setup-worktree.sh at creation. When that
  # did not run, the first failure is a posting check reporting a missing linter, so say it here.
  if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    log "WARNING: node_modules is missing. Run scripts/setup-worktree.sh before lint, test or commit."
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Node 20
# ---------------------------------------------------------------------------
# The repo pins Node 20 (.nvmrc, .mise.toml, CI's node-version-file). engines.node
# is only a floor (>=20.19.0), so a newer Node satisfies it and still breaks things:
# under Node 24 Electron's postinstall silently fails to extract its binary, leaving
# node_modules/electron/dist broken while install exits 0.
#
# The remote image ships Node 20 at /opt/node20 but puts /opt/node22 earlier on PATH,
# so `node` resolves to 22 by default. Prepending is usually all that is needed.
# pnpm's shebang is `#!/usr/bin/env node`, so it follows PATH and runs under whichever
# Node wins here — no separate pnpm install is required.

find_node20() {
  local candidate
  for candidate in /opt/node20/bin "$HOME"/.nvm/versions/node/v20.*/bin; do
    if [ -x "$candidate/node" ] && [[ "$("$candidate/node" --version 2>/dev/null)" == v20.* ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

if ! NODE20_BIN="$(find_node20)"; then
  log "Node 20 not present in the image; downloading from nodejs.org"
  NODE20_VERSION="$(curl -fsSL --max-time 60 https://nodejs.org/dist/latest-v20.x/ \
    | grep -oE 'node-v20\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -1 | sed -E 's/node-(v[0-9.]+)-.*/\1/')"
  curl -fsSL --max-time 300 \
    "https://nodejs.org/dist/${NODE20_VERSION}/node-${NODE20_VERSION}-linux-x64.tar.xz" \
    -o /tmp/node20.tar.xz
  mkdir -p /opt/node20
  tar -xJf /tmp/node20.tar.xz -C /opt/node20 --strip-components=1
  rm -f /tmp/node20.tar.xz
  NODE20_BIN=/opt/node20/bin
fi

export PATH="$NODE20_BIN:$PATH"
persist_env "export PATH=\"$NODE20_BIN:\$PATH\""
log "node $(node --version), pnpm $(pnpm --version 2>/dev/null || echo 'missing')"

# ---------------------------------------------------------------------------
# 2. gh CLI
# ---------------------------------------------------------------------------
# .claude/settings.json allowlists a dozen `gh` commands and the dispatch skill and
# agent contracts are written against gh, but the remote image does not ship it.
#
# Prefer GitHub's own apt repo (current release) and fall back to the Ubuntu archive
# (older, but always reachable). Never fatal: a transient apt failure must not block
# every session from starting. GH_TOKEN is already exported by the environment, so no
# `gh auth login` step is needed.
#
# NOTE: installing gh does not make every gh command work here — see the GraphQL
# limitation documented in docs/agents/github-access.md.

install_gh() {
  install -d -m 0755 /etc/apt/keyrings
  if curl -fsSL --max-time 60 https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; then
    chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list
    # Refresh only this source; a full `apt-get update` is slow and unnecessary.
    if apt-get update -qq \
         -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/github-cli.list \
         -o Dir::Etc::sourceparts=/dev/null \
         -o APT::Get::List-Cleanup=0 >/dev/null 2>&1 \
       && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gh >/dev/null 2>&1; then
      return 0
    fi
    log "GitHub apt repo failed; falling back to the Ubuntu archive"
    rm -f /etc/apt/sources.list.d/github-cli.list
  fi
  apt-get update -qq >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gh >/dev/null 2>&1
}

if command -v gh >/dev/null 2>&1; then
  log "gh already installed ($(gh --version | head -1))"
elif install_gh && command -v gh >/dev/null 2>&1; then
  log "installed $(gh --version | head -1)"
else
  log "WARNING: gh install failed. Use the GitHub MCP tools instead this session."
fi

# ---------------------------------------------------------------------------
# 3. Vale
# ---------------------------------------------------------------------------
# .claude/hooks/vale-prose.sh blocks an edit that breaks the writing guide, but it passes
# when Vale is absent, so a container without Vale has no prose gate at all. The remote
# image has no mise, so install the pinned release directly. Never fatal. Keep VALE_VERSION
# in sync with .mise.toml.

VALE_VERSION="3.24.0"

install_vale() {
  local arch tarball
  case "$(uname -m)" in
    x86_64) arch="64-bit" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) log "vale: no release for $(uname -m)"; return 1 ;;
  esac
  tarball="vale_${VALE_VERSION}_Linux_${arch}.tar.gz"
  curl -fsSL --max-time 120 \
    "https://github.com/errata-ai/vale/releases/download/v${VALE_VERSION}/${tarball}" \
    -o /tmp/vale.tar.gz \
    && install -d -m 0755 /usr/local/bin \
    && tar -xzf /tmp/vale.tar.gz -C /usr/local/bin vale \
    && rm -f /tmp/vale.tar.gz
}

if command -v vale >/dev/null 2>&1; then
  log "vale already installed ($(vale --version))"
elif install_vale && command -v vale >/dev/null 2>&1; then
  log "installed $(vale --version)"
else
  log "WARNING: vale install failed; the prose hook will pass every Markdown edit this session."
fi
if command -v vale >/dev/null 2>&1 && [ ! -d "$PROJECT_DIR/.vale/styles/Google" ]; then
  (cd "$PROJECT_DIR" && vale sync >/dev/null 2>&1) || log "WARNING: vale sync failed; prose linting unavailable"
fi

# ---------------------------------------------------------------------------
# 4. Project dependencies
# ---------------------------------------------------------------------------
# Plain `install` rather than `--frozen-lockfile`, so the container's cached state is
# reused across sessions. postinstall runs scripts/ensure-electron.mjs (the backstop
# for the silent-extract-failure above) and scripts/rebuild-native.mjs (better-sqlite3).

cd "$PROJECT_DIR"
log "installing dependencies"
pnpm install

# Fatal, unlike the gh failure above. A missing Electron binary is the silent-extract
# failure this hook exists to catch, and it does not fail loudly on its own: `pnpm test`
# runs vitest *through* Electron, so a broken runtime produces a confusing error rather
# than an obviously-absent dependency. Reporting "ready" here would hand the session a
# verify loop whose results cannot be trusted, which is worse than refusing to start.
if [ ! -x node_modules/electron/dist/electron ]; then
  log "FATAL: node_modules/electron/dist/electron is missing after install."
  log "       pnpm test runs vitest through Electron, so its results would be meaningless."
  log "       Check 'node --version' is 20.x, then re-run 'pnpm install'."
  exit 1
fi
log "electron binary present"

log "ready"
