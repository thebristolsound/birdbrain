#!/usr/bin/env bash
#
# Find, or install, the pinned tools an agent needs to check its own work: Node (major from
# .nvmrc) and Vale (version from .mise.toml) with its synced Google style. Works the same on a
# host with mise, without mise, on a GitHub Actions runner and in a cloud container, and never
# needs root: without mise it installs into a per-user cache that every worktree on the host
# shares, so only the first worktree downloads anything.
#
#   scripts/install-tools.sh               install what is missing, then resolve
#   scripts/install-tools.sh --no-install  resolve only: no mise install, no download, no writes
#
# Prints one line on stdout: the directories to put first on PATH, colon-joined (possibly
# empty). Logs go to stderr. Exits 1 when Node, Vale or the Google style is still missing.
#
# BIRDBRAIN_TOOLS_DIR overrides the cache, which defaults to ~/.cache/birdbrain/tools.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="${BIRDBRAIN_TOOLS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/birdbrain/tools}"
install=1
[ "${1:-}" = "--no-install" ] && install=0

log() { echo "[install-tools] $*" >&2; }

NODE_MAJOR="$(tr -d '[:space:]v' <"$ROOT/.nvmrc")"
VALE_VERSION="$(sed -nE 's/^vale *= *"([^"]+)".*/\1/p' "$ROOT/.mise.toml")"
[ -n "$NODE_MAJOR" ] || { log "ERROR: no Node major in .nvmrc"; exit 1; }
[ -n "$VALE_VERSION" ] || { log "ERROR: no vale pin in .mise.toml"; exit 1; }

case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) os="" ;; esac
case "$(uname -m)" in x86_64 | amd64) arch=x64 ;; aarch64 | arm64) arch=arm64 ;; *) arch="" ;; esac

MISE="$(command -v mise 2>/dev/null || true)"
if [ -z "$MISE" ] && [ -x "$HOME/.local/bin/mise" ]; then MISE="$HOME/.local/bin/mise"; fi

mise_where() { [ -n "$MISE" ] && (cd "$ROOT" && "$MISE" where "$1" 2>/dev/null); }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi |
    cut -d' ' -f1
}

# Downloads $1 to $2 and checks it against the entry for file name $3 in the checksum list at $4.
fetch_verified() {
  local url="$1" out="$2" name="$3" sums_url="$4" want
  want="$(curl -fsSL --max-time 60 "$sums_url" | awk -v n="$name" '$2 == n { print $1 }')"
  [ -n "$want" ] || { log "no checksum for $name in $sums_url"; return 1; }
  curl -fsSL --max-time 300 "$url" -o "$out" || { log "download failed: $url"; return 1; }
  [ "$(sha256 "$out")" = "$want" ] || { log "checksum mismatch for $name"; return 1; }
}

node_major_in() { "$1/node" --version 2>/dev/null | sed -nE 's/^v([0-9]+)\..*/\1/p'; }
vale_version_in() { "$1/vale" --version 2>/dev/null | sed -nE 's/^vale version v?([0-9.]+).*/\1/p'; }

resolve_node() {
  local d
  d="$(mise_where node || true)"
  if [ -n "$d" ] && [ "$(node_major_in "$d/bin")" = "$NODE_MAJOR" ]; then echo "$d/bin"; return; fi
  if command -v node >/dev/null 2>&1; then
    d="$(dirname "$(command -v node)")"
    if [ "$(node_major_in "$d")" = "$NODE_MAJOR" ]; then echo "$d"; return; fi
  fi
  for d in "$TOOLS"/node-v"$NODE_MAJOR".*/bin; do
    if [ "$(node_major_in "$d")" = "$NODE_MAJOR" ]; then echo "$d"; return; fi
  done
  return 1
}

# Pinned version only: mise, then PATH, then the cache.
resolve_vale() {
  local d c
  d="$(mise_where vale || true)"
  for c in ${d:+"$d" "$d/bin"} "$(dirname "$(command -v vale 2>/dev/null || echo /none/vale)")" \
    "$TOOLS/vale-$VALE_VERSION"; do
    if [ "$(vale_version_in "$c")" = "$VALE_VERSION" ]; then echo "$c"; return; fi
  done
  return 1
}

install_node() {
  local base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x" name tmp
  [ -n "$os" ] && [ -n "$arch" ] || { log "no Node build for $(uname -sm)"; return 1; }
  name="$(curl -fsSL --max-time 60 "$base/SHASUMS256.txt" |
    awk -v re="^node-v[0-9.]+-${os}-${arch}[.]tar[.]gz\$" '$2 ~ re { print $2; exit }')"
  [ -n "$name" ] || { log "no Node $NODE_MAJOR build listed for $os-$arch"; return 1; }
  log "downloading $name into $TOOLS"
  tmp="$(mktemp -d "$TOOLS/.node.XXXXXX")"
  if fetch_verified "$base/$name" "$tmp/$name" "$name" "$base/SHASUMS256.txt" &&
    tar -xzf "$tmp/$name" -C "$tmp"; then
    # Another worktree may have finished the same install first; either copy will do.
    [ -d "$TOOLS/${name%-"$os"-*}" ] || mv "$tmp/${name%.tar.gz}" "$TOOLS/${name%-"$os"-*}" || true
  fi
  rm -rf "$tmp"
}

install_vale() {
  local base="https://github.com/errata-ai/vale/releases/download/v${VALE_VERSION}" vos varch name tmp
  case "$os" in linux) vos=Linux ;; darwin) vos=macOS ;; *) vos="" ;; esac
  case "$arch" in x64) varch=64-bit ;; arm64) varch=arm64 ;; *) varch="" ;; esac
  [ -n "$vos" ] && [ -n "$varch" ] || { log "no Vale build for $(uname -sm)"; return 1; }
  name="vale_${VALE_VERSION}_${vos}_${varch}.tar.gz"
  log "downloading $name into $TOOLS"
  tmp="$(mktemp -d "$TOOLS/.vale.XXXXXX")"
  mkdir "$tmp/out"
  if fetch_verified "$base/$name" "$tmp/$name" "$name" "$base/vale_${VALE_VERSION}_checksums.txt" &&
    tar -xzf "$tmp/$name" -C "$tmp/out" vale; then
    [ -d "$TOOLS/vale-$VALE_VERSION" ] || mv "$tmp/out" "$TOOLS/vale-$VALE_VERSION" || true
  fi
  rm -rf "$tmp"
}

# The Google style is gitignored and fetched per checkout. A copy kept in the cache lets a
# worktree on a host whose network refuses `vale sync` still get it (#1067).
sync_styles() {
  local vale_dir="$1" cache="$TOOLS/vale-styles/Google"
  [ -d "$ROOT/.vale/styles/Google" ] && return 0
  if (cd "$ROOT" && PATH="$vale_dir:$PATH" vale sync >/dev/null 2>&1) &&
    [ -d "$ROOT/.vale/styles/Google" ]; then
    mkdir -p "$TOOLS/vale-styles"
    rm -rf "$cache.tmp.$$"
    cp -R "$ROOT/.vale/styles/Google" "$cache.tmp.$$" && rm -rf "$cache" && mv "$cache.tmp.$$" "$cache"
  elif [ -d "$cache" ]; then
    cp -R "$cache" "$ROOT/.vale/styles/Google"
    log "vale sync failed; copied the Google style from $cache"
  else
    log "vale sync failed and $cache holds no copy"
    return 1
  fi
}

if [ "$install" = 1 ]; then
  mkdir -p "$TOOLS"
  if [ -n "$MISE" ]; then
    (cd "$ROOT" && "$MISE" install --quiet node vale >&2) || log "mise install failed; using the cache"
  fi
fi

missing=()
dirs=()

node_dir="$(resolve_node || true)"
if [ -z "$node_dir" ] && [ "$install" = 1 ]; then
  install_node || true
  node_dir="$(resolve_node || true)"
fi
if [ -n "$node_dir" ]; then
  dirs+=("$node_dir")
  # A cache-installed Node has no pnpm; corepack ships with it and reads packageManager.
  if [ "$install" = 1 ] && ! PATH="$node_dir:$PATH" command -v pnpm >/dev/null 2>&1 &&
    [ -x "$node_dir/corepack" ] && [ -w "$node_dir" ]; then
    if ! { PATH="$node_dir:$PATH" "$node_dir/corepack" enable pnpm --install-directory "$node_dir" &&
      (cd "$ROOT" && PATH="$node_dir:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
        "$node_dir/corepack" install >&2); }; then
      log "corepack could not provide pnpm"
    fi
  fi
else
  missing+=("node $NODE_MAJOR")
fi

vale_dir="$(resolve_vale || true)"
if [ -z "$vale_dir" ] && [ "$install" = 1 ]; then
  install_vale || true
  vale_dir="$(resolve_vale || true)"
fi
if [ -n "$vale_dir" ]; then
  dirs+=("$vale_dir")
  if [ "$install" = 1 ]; then
    sync_styles "$vale_dir" || missing+=("vale Google style")
  elif [ ! -d "$ROOT/.vale/styles/Google" ]; then
    missing+=("vale Google style")
  fi
else
  missing+=("vale $VALE_VERSION")
fi

(
  IFS=:
  echo "${dirs[*]-}"
)

if [ ${#missing[@]} -gt 0 ]; then
  list="$(IFS=,; echo "${missing[*]}")"
  log "missing: ${list//,/, }"
  exit 1
fi
