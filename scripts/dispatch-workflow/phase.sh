#!/usr/bin/env bash
# One phase of a dispatch fire on the maintainer's machine. birdbrain-dispatch.ts beside this
# file is a T3 Code durable workflow that runs each phase as one step, in the order
# .github/workflows/dispatch.yml runs its steps (ADR-0026): identity, pregate, toolchain,
# ledger, credential, cycle-start, cycle-check until the cycle ends, postcheck, and finish
# when the run ends.
#
# Phases share no shell state, because the workflow can run each in a new process after a
# server restart. What one phase leaves for a later one is a file in the run directory.
#
# Usage: phase.sh <phase>
# Env: RUN_ID (required: the workflow's run id, used as the run directory's name),
#      MODE (report, the default, or cycle), TARGET_ISSUE (optional issue number),
#      JOB_STATUS (finish only: success, failure or cancelled),
#      DISPATCH_STATE_DIR (default $XDG_STATE_HOME/birdbrain-dispatch),
#      BIRDBRAIN_AGENT_ENV_FILE, CLAUDE_BIN, CLAUDE_CONFIG_DIR (default ~/.claude),
#      DISPATCH_MODEL, DISPATCH_EFFORT, DISPATCH_TIMEOUT_MINUTES (default 110),
#      DISPATCH_KEEP_DAYS (default 7).
# Stdout: one line, the phase's result. pregate prints `run` or `idle: <reason>`, and
#         cycle-check prints `running` while the cycle has not ended.
# Exit: 0 when the phase passed; 2 on a usage error; 1 otherwise, with the reason as the last
#       line of stderr and as a `Failed:` line in the run directory's summary.md.
set -euo pipefail

phase="${1:-}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"
steps=.github/scripts/dispatch
# shellcheck source=.github/scripts/dispatch/lib.sh
. "$steps/lib.sh"

: "${RUN_ID:?RUN_ID is not set}"
[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "RUN_ID '$RUN_ID' is not a file name" >&2; exit 2; }
mode="${MODE:-report}"
case "$mode" in
  report | cycle) ;;
  *) echo "MODE must be report or cycle, not '$mode'" >&2; exit 2 ;;
esac
target="${TARGET_ISSUE:-}"
[ -z "$target" ] || [[ "$target" =~ ^[0-9]+$ ]] || { echo "TARGET_ISSUE takes an issue number" >&2; exit 2; }

state="${DISPATCH_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/birdbrain-dispatch}"
run_dir="$state/runs/$RUN_ID"
mkdir -p "$run_dir"
summary="$run_dir/summary.md"
ledger="$state/ledger.jsonl"
pid_file="$run_dir/cycle.pid"
exit_file="$run_dir/cycle.exit"
timeout_minutes="${DISPATCH_TIMEOUT_MINUTES:-110}"
# Every later step measures from the first phase of the run, so a phase that runs twice
# keeps the first start.
[ -s "$run_dir/started" ] || date -u +%FT%TZ > "$run_dir/started"
host_name="$(hostname)"
export GITHUB_STEP_SUMMARY="$summary" TARGET_ISSUE="$target" DISPATCH_LOCAL_LEDGER="$ledger"
export RUN_URL="local dispatch run $RUN_ID on $host_name"

# Stdout carries only the result line the workflow journals.
note() {
  echo "$*" >> "$summary"
  echo "$*" >&2
}
fail() {
  echo "Failed: $*" >> "$summary"
  echo "$*" >&2
  exit 1
}

# The server that runs the workflow has not run mise's hook, so the repository's Node pin
# loses to whatever Node that process had (scripts/setup-worktree.sh has the history).
if command -v mise > /dev/null 2>&1; then
  eval "$(mise env -s bash 2> /dev/null || true)"
fi
# The only `claude` the step scripts see, once the toolchain phase has written it.
[ ! -d "$run_dir/bin" ] || export PATH="$run_dir/bin:$PATH"
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# The machine identity for a phase that reads or writes GitHub (ADR-0027). The file is
# sourced, never exported: the token reaches only this phase's own processes, as GH_TOKEN.
# Commit authorship goes through GIT_* variables because this checkout's git config is the
# maintainer's and every worktree shares it.
load_identity() {
  local env_file login id
  [ -s "$run_dir/identity" ] || fail "the identity phase has not passed for run $RUN_ID"
  env_file="${BIRDBRAIN_AGENT_ENV_FILE:-$HOME/.config/birdbrain-agent/env}"
  [ -r "$env_file" ] || fail "machine identity file $env_file is missing (ADR-0027)"
  # shellcheck disable=SC1090
  . "$env_file"
  IFS=$'\t' read -r login id < "$run_dir/identity"
  export GH_TOKEN="${BIRDBRAIN_AGENT_GH_TOKEN:?}" LOGIN="$login"
  STARTED="$(cat "$run_dir/started")"
  export STARTED
  export GIT_AUTHOR_NAME="$login" GIT_COMMITTER_NAME="$login"
  export GIT_AUTHOR_EMAIL="${id}+${login}@users.noreply.github.com"
  export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
}

# True while the cycle launched by the run whose directory is $1 is still running. The boot
# id tells a live process group from a process id a reboot handed to something else.
cycle_alive() {
  local pid pid_boot
  [ -s "$1/cycle.pid" ] && [ ! -s "$1/cycle.exit" ] || return 1
  read -r pid pid_boot _ < "$1/cycle.pid"
  [ "$pid_boot" = "$(cat /proc/sys/kernel/random/boot_id)" ] && kill -0 -- "-$pid" 2> /dev/null
}

case "$phase" in
  identity)
    # The spend cap counts this host's cycles only where the pre-gate reads the ledger, and
    # the cycle is told which host it runs on only where run.sh knows of one. A checkout
    # without those must not fire.
    grep -q DISPATCH_LOCAL_LEDGER "$steps/pregate.sh" "$steps/cap.sh" 2> /dev/null \
      || fail "this checkout's pre-gate does not read DISPATCH_LOCAL_LEDGER, so its spend cap would not count this host's cycles"
    grep -q DISPATCH_HOST "$steps/run.sh" \
      || fail "this checkout's run.sh does not read DISPATCH_HOST, so the cycle would be told it runs on GitHub Actions"
    grep -q CLAUDE_TOKEN_SOURCE .github/scripts/health/claude-token.sh \
      || fail "this checkout's claude-token.sh does not read CLAUDE_TOKEN_SOURCE, so it cannot probe the CLI's stored login"

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
      fail "GitHub rejected the machine token: $(grep -v '^$' "$run_dir/identity.err" | tail -n 1)"
    fi
    login="${who%%$'\t'*}"
    id="${who#*$'\t'}"
    if [ "$login" != "$expected" ]; then
      fail "machine token resolves to '$login', expected '$expected'"
    fi
    if [ "$login" = "$MAINTAINER" ]; then
      fail "machine token resolves to the maintainer; ADR-0027 forbids dispatch under that identity"
    fi
    printf '%s\t%s\n' "$login" "$id" > "$run_dir/identity"
    result="Identity: $login (id $id), token expires $expires, run started $(cat "$run_dir/started")"
    note "$result"
    echo "$result"
    ;;

  pregate)
    load_identity
    gate_out="$run_dir/gate.out"
    : > "$gate_out"
    # The pre-gate holds on a ledger it is given and cannot find, so the first fire on this
    # machine starts an empty one.
    [ -e "$ledger" ] || : > "$ledger" || fail "could not start the ledger $ledger"
    if ! GITHUB_OUTPUT="$gate_out" bash "$steps/pregate.sh" "$mode" > "$run_dir/pregate.log" 2>&1; then
      tail -n 20 "$run_dir/pregate.log" >&2
      fail "pre-gate exited non-zero; see $run_dir/pregate.log"
    fi
    reason="$(sed -n 's/^reason=//p' "$gate_out" | tail -n 1)"
    case "$(sed -n 's/^run=//p' "$gate_out" | tail -n 1)" in
      true) echo run ;;
      false) echo "idle: ${reason:-the pre-gate gave no reason}" ;;
      *) fail "pre-gate exited 0 without a run= decision; see $run_dir/pregate.log" ;;
    esac
    ;;

  toolchain)
    # The workflow's own limit of one run at a time ends when a run is cancelled, while that
    # run's cycle can still be stopping. Two cycles would share .dispatch in one checkout.
    for other in "$state"/runs/*/; do
      other="${other%/}"
      if [ "$other" != "$run_dir" ] && cycle_alive "$other"; then
        fail "run $(basename "$other") still has a cycle running; this fire does not start a second one"
      fi
    done
    want="$(sed -E 's/^v?([0-9]+).*/\1/' .nvmrc)"
    have="$(node --version 2> /dev/null | sed -E 's/^v([0-9]+).*/\1/')"
    if [ -z "$want" ] || [ "$have" != "$want" ]; then
      fail "node ${have:-missing} on PATH; this repository pins Node ${want:-<unreadable .nvmrc>}. Run mise install"
    fi
    if [ ! -d node_modules/electron/dist ]; then
      note "node_modules is missing or incomplete; running scripts/setup-worktree.sh"
      bash scripts/setup-worktree.sh > "$run_dir/setup.log" 2>&1 \
        || fail "scripts/setup-worktree.sh failed; see $run_dir/setup.log"
    fi
    # The `claude` on the maintainer's PATH is a launcher that checks for updates first and
    # did not return within 30 seconds on 2026-10-08, so the binary mise installed wins.
    claude_bin="${CLAUDE_BIN:-}"
    if [ -z "$claude_bin" ] && command -v mise > /dev/null 2>&1; then
      claude_bin="$(mise where claude 2> /dev/null || true)"
      [ -z "$claude_bin" ] || claude_bin="$claude_bin/claude"
    fi
    [ -n "$claude_bin" ] || claude_bin="$(command -v claude 2> /dev/null || true)"
    if [ -z "$claude_bin" ] || [ ! -x "$claude_bin" ]; then
      fail "no Claude Code CLI found; set CLAUDE_BIN to the binary"
    fi
    mkdir -p "$run_dir/bin"
    printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$claude_bin" > "$run_dir/bin/claude"
    chmod 0755 "$run_dir/bin/claude"
    claude_version="$("$claude_bin" --version 2> /dev/null < /dev/null | head -n 1 || echo unknown)"

    # The cycle runs this tree's skill and agent definitions, whatever branch it is on. The
    # workflow on Actions checks out main; here the checkout is the caller's, so say what it is.
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
    result="Toolchain: node $(node --version), claude ${claude_version:-unknown} at $claude_bin, config $CLAUDE_CONFIG_DIR"
    note "$result"
    echo "$result"
    ;;

  ledger)
    # The spend cap counts a cycle from the start of its first paid step (CAP_PAID_STEP in
    # pregate.sh). That step is next, so the record goes in now, before anything can fail,
    # and once per run however often this phase runs. No target line reads as null, which
    # the cap counts against every target. The title is CAP_TARGET_TITLE in pregate.sh.
    if [ -s "$ledger" ] && jq -e -s --arg run "$RUN_ID" 'any(.[]; .run == $run)' "$ledger" > /dev/null 2>&1; then
      echo "Ledger: run $RUN_ID is already recorded"
      exit 0
    fi
    targets="$(sed -n 's/^::notice title=Dispatch target:://p' "$run_dir/pregate.log" | tail -n 1)"
    jq -n -c --arg at "$(date -u +%FT%TZ)" --arg targets "$targets" --arg mode "$mode" --arg run "$RUN_ID" \
      '{at: $at, targets: (if $targets == "" then null else [$targets | scan("[0-9]+") | tonumber] end),
        mode: $mode, run: $run}' >> "$ledger" \
      || fail "could not record the paid cycle in $ledger"
    echo "Ledger: recorded run $RUN_ID for targets ${targets:-<none named>}"
    ;;

  credential)
    # The token when the environment carries one, else the login the CLI holds in
    # CLAUDE_CONFIG_DIR.
    export CLAUDE_TOKEN_SOURCE="${CLAUDE_TOKEN_SOURCE:-${CLAUDE_CODE_OAUTH_TOKEN:+token}}"
    : "${CLAUDE_TOKEN_SOURCE:=login}"
    if ! bash .github/scripts/health/claude-token.sh > "$run_dir/probe.log" 2>&1; then
      tail -n 20 "$run_dir/probe.log" >&2
      fail "Claude credential probe failed: $(grep -v '^::' "$run_dir/probe.log" | head -n 1)"
    fi
    result="Claude credential: $(tail -n 1 "$run_dir/probe.log")"
    note "$result"
    echo "$result"
    ;;

  cycle-start)
    load_identity
    if [ -s "$pid_file" ]; then
      echo "Cycle: already launched as process group $(cut -d' ' -f1 "$pid_file")"
      exit 0
    fi
    # The marker goes down before the launch, so a phase that died between the two reads as a
    # cycle that may have started, and a paid cycle is never started twice.
    if [ -e "$run_dir/cycle.launched" ]; then
      fail "an earlier attempt of this run was interrupted while launching the cycle; it is not run again"
    fi
    # Hooks and permissions in .claude/settings.json apply in a trusted workspace. The CLI
    # keeps that record in its config directory, keyed by the main repository root, not the
    # worktree path. Written only when absent, and atomically, since the maintainer's own
    # sessions write the same file.
    cfg="$CLAUDE_CONFIG_DIR/.claude.json"
    trust_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    [ -s "$cfg" ] || echo '{}' > "$cfg"
    if ! jq -e --arg d "$trust_root" '.projects[$d].hasTrustDialogAccepted == true' "$cfg" > /dev/null; then
      jq --arg d "$trust_root" '.projects[$d].hasTrustDialogAccepted = true' "$cfg" > "$cfg.dispatch-local" \
        && mv "$cfg.dispatch-local" "$cfg"
    fi

    export DISPATCH_HOST=local DISPATCH_RUN_DIR="$run_dir"
    export DISPATCH_MODEL="${DISPATCH_MODEL:-claude-opus-5-5}" DISPATCH_EFFORT="${DISPATCH_EFFORT:-high}"
    : > "$run_dir/cycle.launched"
    # Its own session, and no step waits on it: T3 Code does not stop a step's process when
    # its run is cancelled (birdbrain-dispatch.ts has the observation). The workflow polls
    # cycle-check instead, and finish stops a cycle that is still running.
    # shellcheck disable=SC2016 # the inner shell expands its own arguments
    setsid bash -c 'timeout -k 60 "$1" bash "$2" "$3" > "$4/run.log" 2>&1; echo $? > "$4/cycle.exit"' \
      _ "${timeout_minutes}m" "$steps/run.sh" "$mode" "$run_dir" < /dev/null > /dev/null 2>&1 &
    echo "$! $(cat /proc/sys/kernel/random/boot_id) $(date +%s)" > "$pid_file"
    echo "Cycle: launched as process group $!"
    ;;

  cycle-check)
    [ -s "$pid_file" ] || fail "no cycle was launched for run $RUN_ID"
    if [ ! -s "$exit_file" ]; then
      if cycle_alive "$run_dir"; then
        read -r _ _ launched < "$pid_file"
        if [ "$(date +%s)" -ge $((launched + timeout_minutes * 60 + 180)) ]; then
          fail "the cycle is still running $((timeout_minutes + 3)) minutes after its launch; see $run_dir/run.log"
        fi
        echo running
        exit 0
      fi
      # The exit status is written as the process group ends.
      sleep 1
      [ -s "$exit_file" ] \
        || fail "the cycle's process is gone and left no exit status (a kill or a reboot); it is not run again. See $run_dir/run.log"
    fi
    run_status="$(cat "$exit_file")"
    case "$run_status" in
      0) echo "Cycle: finished; see $run_dir/run.log" ;;
      124)
        tail -n 20 "$run_dir/run.log" >&2
        fail "the cycle ran past $timeout_minutes minutes and was stopped; see $run_dir/run.log"
        ;;
      *)
        tail -n 20 "$run_dir/run.log" >&2
        fail "the cycle exited $run_status; see $run_dir/run.log"
        ;;
    esac
    ;;

  postcheck)
    # Reads GitHub, not the report (ADR-0026), on a cycle that could have written.
    load_identity
    if ! bash "$steps/postcheck.sh" > "$run_dir/postcheck.log" 2>&1; then
      tail -n 20 "$run_dir/postcheck.log" >&2
      fail "post-check found a problem; see $run_dir/postcheck.log"
    fi
    echo "Post-check: passed"
    ;;

  finish)
    # dispatch.yml's always() steps: cleanup, friction notes, scrub, then the artifact, here a
    # move into the run directory. Each part runs however the others end, and the phase can
    # run again after a failure.
    status="${JOB_STATUS:-failure}"
    code=0
    if cycle_alive "$run_dir"; then
      read -r pid _ < "$pid_file"
      note "Stopping the cycle still running as process group $pid"
      kill -TERM -- "-$pid" 2> /dev/null || true
      for _ in $(seq 1 90); do
        cycle_alive "$run_dir" || break
        sleep 1
      done
      ! cycle_alive "$run_dir" || kill -KILL -- "-$pid" 2> /dev/null || true
    fi
    if [ -s "$run_dir/identity" ]; then
      if ! (load_identity && JOB_STATUS="$status" bash "$steps/cleanup.sh") > "$run_dir/cleanup.log" 2>&1; then
        note "Cleanup step failed; see $run_dir/cleanup.log"
        code=1
      fi
      if [ "$mode" = cycle ] && [ -e "$run_dir/cycle.launched" ] && [ ! -e "$run_dir/friction.done" ]; then
        if (load_identity && GITHUB_SHA="$(git rev-parse HEAD)" bash "$steps/friction.sh") > "$run_dir/friction.log" 2>&1; then
          : > "$run_dir/friction.done"
        else
          note "Friction notes step failed; see $run_dir/friction.log"
        fi
      fi
    fi
    if [ -d .dispatch ]; then
      bash "$steps/scrub.sh" || note "Scrub failed; check $run_dir/dispatch before sharing it"
      rm -rf "$run_dir/dispatch"
      mv .dispatch "$run_dir/dispatch"
    fi
    echo "$status" > "$run_dir/status"
    ln -sfn "runs/$RUN_ID" "$state/latest"
    find "$state/runs" -mindepth 1 -maxdepth 1 -type d -mtime +"${DISPATCH_KEEP_DAYS:-7}" \
      -exec rm -rf {} + 2> /dev/null || true
    result="Run $RUN_ID ended: $status. Files: $run_dir"
    echo "$result" >> "$summary"
    echo "$result"
    exit "$code"
    ;;

  *)
    echo "Unknown phase '$phase'. Phases: identity pregate toolchain ledger credential cycle-start cycle-check postcheck finish" >&2
    exit 2
    ;;
esac
