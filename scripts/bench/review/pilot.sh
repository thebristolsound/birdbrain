#!/usr/bin/env bash
# Stage 3 pilot: the full effort sweep on five cases, three reps, tier L1.
#
#   pilot.sh claude   # Opus 5 (baseline), Opus 5.5, Fable 5.1 at low..max
#   pilot.sh codex    # Astra, Sol at every level the model cache lists
#
# One vendor per invocation so the two subscriptions run side by side while
# each vendor stays serial. Every run.mjs call is resumable, so re-running
# this script after a rate limit continues from the rows still owed; a
# rate-limited run exits 3 and this script waits before the next attempt
# rather than hammering the window.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vendor="${1:?claude or codex}"
cases="${PILOT_CASES:-m03,m04,m12,m17,r-709}"
reps="${PILOT_REPS:-3}"
tier="${PILOT_TIER:-L1}"
timeout_ms="${PILOT_TIMEOUT_MS:-2700000}"
retry_wait="${PILOT_RETRY_WAIT_S:-1800}"

case "$vendor" in
  claude)
    models="claude-opus-5 claude-opus-5-5 claude-fable-5-1"
    efforts="low,medium,high,xhigh,max"
    ;;
  codex)
    models="gpt-6-astra gpt-5.6-sol"
    efforts="low,medium,high,xhigh,max,ultra"
    ;;
  *) echo "unknown vendor $vendor" >&2; exit 2 ;;
esac

for model in $models; do
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    echo "== $(date -u +%FT%TZ) $vendor $model $tier efforts=$efforts attempt $attempt"
    set +e
    node "$here/run.mjs" --harness "$vendor" --model "$model" --tier "$tier" \
      --effort "$efforts" --reps "$reps" --cases "$cases" --timeout "$timeout_ms"
    status=$?
    set -e
    if [ "$status" -eq 0 ]; then break; fi
    if [ "$status" -eq 3 ]; then
      echo "== rate limited; waiting ${retry_wait}s before resuming"
      sleep "$retry_wait"
      continue
    fi
    echo "== run.mjs exited $status; stopping" >&2
    exit "$status"
  done
done
echo "== $(date -u +%FT%TZ) $vendor sweep complete"
