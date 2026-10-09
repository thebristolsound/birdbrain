#!/usr/bin/env bash
# One cycle of the dispatch routine on the maintainer's machine, through the gates
# .github/workflows/dispatch.yml runs on a hosted runner, with the same step scripts and in
# the same order: identity, pre-gate, Claude credential, the cycle, post-check, cleanup and
# scrub. The workflow is the reference (ADR-0026); this script is the local host for a
# t3code scheduled task, or for a fire by hand. Operating notes, the task prompt and the
# known differences: docs/agents/dispatch-local.md.
#
# Usage: scripts/dispatch-local.sh [report|cycle] [--issue <n>]
#   report (default)  classify and report; write nothing to GitHub.
#   cycle             run one full cycle; --issue narrows section 3 to that issue.
#
# What differs from the workflow:
#   - Identity is ~/.config/birdbrain-agent/env (ADR-0027), checked here rather than by
#     identity.sh, which rewrites that file and sets the checkout's git user. This checkout
#     is the maintainer's and its config is shared with every worktree, so the cycle's
#     commit authorship is set through GIT_* variables in its environment instead.
#   - GH_TOKEN for the cycle is the machine token, and gh is the git credential helper, so
#     bare gh and agh are one identity and the implementer pushes as the machine account,
#     as on the Actions host (ADR-0026). The maintainer's own gh login is not touched.
#   - The spend cap counts this host's cycles from DISPATCH_LOCAL_LEDGER beside the Actions
#     runs GitHub lists (pregate.sh). The Actions pre-gate does not see local cycles.
#   - The report surface is a directory under DISPATCH_STATE_DIR: summary.md is the step
#     summary, dispatch/ the artifact, one log per step. Runs older than DISPATCH_KEEP_DAYS
#     days are pruned, and `latest` points at the newest.
#   - CLAUDE_BIN names the CLI the cycle runs, defaulting to the one mise installed. The
#     `claude` on the maintainer's PATH is a launcher that checks for updates first and did
#     not return within 30 seconds on 2026-10-08.
#
# Env: DISPATCH_STATE_DIR (default $XDG_STATE_HOME/birdbrain-dispatch),
#      BIRDBRAIN_AGENT_ENV_FILE, CLAUDE_BIN, CLAUDE_CONFIG_DIR (default ~/.claude),
#      DISPATCH_MODEL, DISPATCH_EFFORT, DISPATCH_TIMEOUT_MINUTES (default 110),
#      DISPATCH_KEEP_DAYS (default 7).
# Exit: 0 after a clean fire, an idle pre-gate included; 2 on a usage error; 3 when another
#       fire holds the lock; 1 otherwise, with the reason in summary.md. SIGINT and SIGTERM
#       stop the cycle, and cleanup still runs.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
steps=.github/scripts/dispatch
# shellcheck source=.github/scripts/dispatch/lib.sh
. "$steps/lib.sh"

mode=report
target=""
while [ $# -gt 0 ]; do
  case "$1" in
    report | cycle) mode="$1" ;;
    --issue)
      target="${2:-}"
      [[ "$target" =~ ^[0-9]+$ ]] || { echo "--issue takes an issue number" >&2; exit 2; }
      shift
      ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument '$1'. Usage: $0 [report|cycle] [--issue <n>]" >&2
      exit 2
      ;;
  esac
  shift
done

state="${DISPATCH_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/birdbrain-dispatch}"
mkdir -p "$state/runs"
# The workflow's concurrency group: one fire at a time. A second fire does nothing rather
# than wait, since the scheduler fires again.
exec 9>"$state/lock"
if ! flock -n 9; then
  echo "Another dispatch fire holds $state/lock; this one does nothing" >&2
  exit 3
fi

run_id="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="$state/runs/$run_id"
mkdir -p "$run_dir"
summary="$run_dir/summary.md"
ledger="$state/ledger.jsonl"
started="$(date -u +%FT%TZ)"
timeout_minutes="${DISPATCH_TIMEOUT_MINUTES:-110}"
export GITHUB_STEP_SUMMARY="$summary"
host_name="$(hostname)"
export RUN_URL="local dispatch run $run_id on $host_name"
export TARGET_ISSUE="$target"
export DISPATCH_LOCAL_LEDGER="$ledger"
export STARTED="$started"

# What cleanup.sh is told about the job: success only where the workflow's job would have
# succeeded, cancelled on a signal, failure otherwise.
status=failure
identity_ok=""
login=""
child=""

note() { echo "$*" | tee -a "$summary"; }
fail() {
  note "Failed: $*"
  exit 1
}

prune() {
  find "$state/runs" -mindepth 1 -maxdepth 1 -type d -mtime +"${DISPATCH_KEEP_DAYS:-7}" \
    -exec rm -rf {} + 2>/dev/null || true
}

# The workflow's always() steps: cleanup, scrub, then the artifact, here a move into the run
# directory. Runs on every exit, a signal included.
finish() {
  local code=$?
  trap - EXIT INT TERM
  if [ -n "$identity_ok" ]; then
    if ! JOB_STATUS="$status" bash "$steps/cleanup.sh" > "$run_dir/cleanup.log" 2>&1; then
      note "Cleanup step failed; see $run_dir/cleanup.log"
      [ "$code" -ne 0 ] || code=1
    fi
  fi
  if [ -d .dispatch ]; then
    bash "$steps/scrub.sh" || note "Scrub failed; check $run_dir/dispatch before sharing it"
    rm -rf "$run_dir/dispatch"
    mv .dispatch "$run_dir/dispatch"
  fi
  echo "$status" > "$run_dir/status"
  ln -sfn "runs/$run_id" "$state/latest"
  prune
  {
    echo
    echo "Run $run_id ended: $status (exit $code). Files: $run_dir"
  } >> "$summary"
  cat "$summary"
  exit "$code"
}
trap finish EXIT
# The cycle runs in its own process group (setsid below), so the signal reaches the CLI and
# every subagent it spawned, and wait returns at once for the trap to run.
on_signal() {
  status=cancelled
  if [ -n "$child" ]; then
    kill -TERM -- "-$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit "$1"
}
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

# Toolchain. A scheduler's shell has not run mise's hook, so the repository's Node 20 pin
# loses to whatever Node the parent shell had (scripts/setup-worktree.sh has the history).
if command -v mise > /dev/null 2>&1; then
  eval "$(mise env -s bash 2> /dev/null || true)"
fi
node_major="$(node --version 2> /dev/null | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$node_major" != 20 ]; then
  fail "node ${node_major:-missing} on PATH; this repository pins Node 20 (.nvmrc). Run mise install"
fi
if [ ! -d node_modules/electron/dist ]; then
  note "node_modules is missing or incomplete; running scripts/setup-worktree.sh"
  bash scripts/setup-worktree.sh > "$run_dir/setup.log" 2>&1 \
    || fail "scripts/setup-worktree.sh failed; see $run_dir/setup.log"
fi
claude_bin="${CLAUDE_BIN:-}"
if [ -z "$claude_bin" ] && command -v mise > /dev/null 2>&1; then
  claude_bin="$(mise where claude 2> /dev/null || true)"
  [ -z "$claude_bin" ] || claude_bin="$claude_bin/claude"
fi
[ -n "$claude_bin" ] || claude_bin="$(command -v claude 2> /dev/null || true)"
if [ -z "$claude_bin" ] || [ ! -x "$claude_bin" ]; then
  fail "no Claude Code CLI found; set CLAUDE_BIN to the binary"
fi
# The only `claude` the step scripts see.
mkdir -p "$run_dir/bin"
printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$claude_bin" > "$run_dir/bin/claude"
chmod 0755 "$run_dir/bin/claude"
export PATH="$run_dir/bin:$PATH"
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
claude_version="$("$claude_bin" --version 2> /dev/null < /dev/null | head -n 1 || echo unknown)"
note "Toolchain: node $(node --version), claude ${claude_version:-unknown} at $claude_bin, config $CLAUDE_CONFIG_DIR"

# The cycle runs this tree's skill and agent definitions, whatever branch it is on. The
# workflow checks out main; here the checkout is the caller's, so say what it is.
rm -rf .dispatch
if git fetch --quiet origin main 2> /dev/null; then
  head_sha="$(git rev-parse HEAD)"
  main_sha="$(git rev-parse origin/main)"
  if [ "$head_sha" != "$main_sha" ]; then
    note "Checkout: ${head_sha:0:8} on $(git symbolic-ref --short -q HEAD || echo detached), not origin/main ${main_sha:0:8}"
  fi
else
  note "Checkout: could not fetch origin/main; freshness unknown"
fi
if [ -n "$(git status --porcelain --untracked-files=no 2> /dev/null)" ]; then
  note "Checkout has uncommitted changes; the cycle runs them as they are"
fi

# Identity (ADR-0027). The file is sourced, never exported: the token reaches only the
# cycle's own processes, as GH_TOKEN below.
env_file="${BIRDBRAIN_AGENT_ENV_FILE:-$HOME/.config/birdbrain-agent/env}"
if [ ! -r "$env_file" ]; then
  fail "machine identity file $env_file is missing (ADR-0027); scripts/setup-agent-github-account.sh provisions it"
fi
# shellcheck disable=SC1090
. "$env_file"
token="${BIRDBRAIN_AGENT_GH_TOKEN:-}"
expected="${BIRDBRAIN_AGENT_GH_LOGIN:-}"
expires="${BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES:-}"
if [ -z "$token" ] || [ -z "$expected" ] || [ -z "$expires" ]; then
  fail "$env_file must set BIRDBRAIN_AGENT_GH_TOKEN, BIRDBRAIN_AGENT_GH_LOGIN and BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES"
fi
if [[ "$expires" < "$(date -u +%F)" ]]; then
  fail "machine token expired on $expires; rotate it with scripts/setup-agent-github-account.sh"
fi
if ! who="$(GH_TOKEN="$token" gh api user --jq '"\(.login)\t\(.id)"' 2> "$run_dir/identity.err")"; then
  fail "GitHub rejected the machine token: $(head -n 1 "$run_dir/identity.err")"
fi
login="${who%%$'\t'*}"
id="${who#*$'\t'}"
if [ "$login" != "$expected" ]; then
  fail "machine token resolves to '$login', expected '$expected'"
fi
if [ "$login" = "$MAINTAINER" ]; then
  fail "machine token resolves to the maintainer; ADR-0027 forbids dispatch under that identity"
fi
identity_ok=1
export GH_TOKEN="$token" LOGIN="$login"
export GIT_AUTHOR_NAME="$login" GIT_COMMITTER_NAME="$login"
export GIT_AUTHOR_EMAIL="${id}+${login}@users.noreply.github.com"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
note "Identity: $login (id $id), token expires $expires, run started $started"

# Pre-gate. Its decision and the target annotation come out the way the workflow reads
# them: run= and reason= in GITHUB_OUTPUT, the ::notice line on stdout.
gate_out="$run_dir/gate.out"
: > "$gate_out"
if ! GITHUB_OUTPUT="$gate_out" bash "$steps/pregate.sh" "$mode" > "$run_dir/pregate.log" 2>&1; then
  tail -n 20 "$run_dir/pregate.log" >&2
  fail "pre-gate exited non-zero; see $run_dir/pregate.log"
fi
gate_run="$(sed -n 's/^run=//p' "$gate_out" | tail -n 1)"
targets="$(sed -n 's/^::notice title=Dispatch target:://p' "$run_dir/pregate.log" | tail -n 1)"
if [ "$gate_run" != true ]; then
  status=success
  exit 0
fi

# The spend cap counts a cycle from the start of its first paid step (CAP_PAID_STEP in
# pregate.sh). That step is next, so the record goes in now, before anything can fail. No
# target line reads as null, which the cap counts against every target.
jq -n -c --arg at "$(date -u +%FT%TZ)" --arg targets "$targets" --arg mode "$mode" --arg run "$run_id" \
  '{at: $at, targets: (if $targets == "" then null else [$targets | scan("[0-9]+") | tonumber] end),
    mode: $mode, run: $run}' >> "$ledger"

# Claude credential: the token when the environment carries one, else the login the CLI
# holds in CLAUDE_CONFIG_DIR.
export CLAUDE_TOKEN_SOURCE="${CLAUDE_TOKEN_SOURCE:-${CLAUDE_CODE_OAUTH_TOKEN:+token}}"
: "${CLAUDE_TOKEN_SOURCE:=login}"
if ! bash .github/scripts/health/claude-token.sh > "$run_dir/probe.log" 2>&1; then
  tail -n 20 "$run_dir/probe.log" >&2
  fail "Claude credential probe failed: $(grep -v '^::' "$run_dir/probe.log" | head -n 1)"
fi
note "Claude credential: $(tail -n 1 "$run_dir/probe.log")"

# Hooks and permissions in .claude/settings.json apply in a trusted workspace, which run.sh
# arranges on Actions. The CLI keeps that record in its config directory, keyed by the main
# repository root, not the worktree path (its own warning names that root, 2026-10-09).
# Written only when the entry is absent, and atomically, since the maintainer's own sessions
# write the same file.
cfg="$CLAUDE_CONFIG_DIR/.claude.json"
trust_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
[ -s "$cfg" ] || echo '{}' > "$cfg"
if ! jq -e --arg d "$trust_root" '.projects[$d].hasTrustDialogAccepted == true' "$cfg" > /dev/null; then
  jq --arg d "$trust_root" '.projects[$d].hasTrustDialogAccepted = true' "$cfg" > "$cfg.dispatch-local" \
    && mv "$cfg.dispatch-local" "$cfg"
fi

# The cycle, bounded the way the job's timeout-minutes bounds it.
export DISPATCH_HOST=local DISPATCH_RUN_DIR="$run_dir"
export DISPATCH_MODEL="${DISPATCH_MODEL:-claude-opus-5-5}" DISPATCH_EFFORT="${DISPATCH_EFFORT:-high}"
setsid timeout -k 60 "${timeout_minutes}m" bash "$steps/run.sh" "$mode" > "$run_dir/run.log" 2>&1 &
child=$!
set +e
wait "$child"
run_status=$?
set -e
child=""
case "$run_status" in
  0) ;;
  124)
    tail -n 20 "$run_dir/run.log" >&2
    fail "the cycle ran past $timeout_minutes minutes and was stopped; see $run_dir/run.log"
    ;;
  *)
    tail -n 20 "$run_dir/run.log" >&2
    fail "the cycle exited $run_status; see $run_dir/run.log"
    ;;
esac

# Post-check reads GitHub, not the report (ADR-0026), on a cycle that could have written.
if [ "$mode" = cycle ]; then
  if ! bash "$steps/postcheck.sh" > "$run_dir/postcheck.log" 2>&1; then
    tail -n 20 "$run_dir/postcheck.log" >&2
    fail "post-check found a problem; see $run_dir/postcheck.log"
  fi
fi
status=success
exit 0
