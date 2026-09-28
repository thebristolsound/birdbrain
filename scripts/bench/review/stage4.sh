#!/usr/bin/env bash
# Stage 4 baseline: the full case set at each model's selected level, two reps.
#
#   stage4.sh claude   # Opus 5 at low and high, then Opus 5.5 and Fable 5.1 at
#                      # low, all direct at tier L1; then the dispatch-mode
#                      # slice (Opus 5.5 at low, every case but wave-2)
#   stage4.sh codex    # Astra and Sol at low, direct, tier L1
#
# One vendor per invocation so the two subscriptions run side by side while
# each vendor stays serial. Every run.mjs call is resumable: re-running this
# script after a rate limit continues from the rows still owed, and a
# rate-limited run (exit 3) waits before the next attempt.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vendor="${1:?claude or codex}"
reps="${STAGE4_REPS:-2}"
tier="${STAGE4_TIER:-L1}"
timeout_ms="${STAGE4_TIMEOUT_MS:-2700000}"
retry_wait="${STAGE4_RETRY_WAIT_S:-1800}"
dispatch_model="${STAGE4_DISPATCH_MODEL:-claude-opus-5-5}"

# model:efforts:mode:extra-args
case "$vendor" in
  claude)
    runs=(
      "claude-opus-5:low,high:direct:"
      "claude-opus-5-5:low:direct:"
      "claude-fable-5-1:low:direct:"
      "$dispatch_model:low:dispatch:--exclude-tag wave2"
    )
    ;;
  codex)
    runs=(
      "gpt-6-astra:low:direct:"
      "gpt-5.6-sol:low:direct:"
    )
    ;;
  *) echo "unknown vendor $vendor" >&2; exit 2 ;;
esac

for spec in "${runs[@]}"; do
  IFS=: read -r model efforts mode extra <<<"$spec"
  args=(--harness "$vendor" --model "$model" --mode "$mode" --effort "$efforts" \
    --reps "$reps" --timeout "$timeout_ms")
  if [ "$mode" = direct ]; then args+=(--tier "$tier"); fi
  # shellcheck disable=SC2206
  if [ -n "$extra" ]; then args+=($extra); fi
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    echo "== $(date -u +%FT%TZ) $vendor $model $mode efforts=$efforts attempt $attempt"
    set +e
    node "$here/run.mjs" "${args[@]}"
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
echo "== $(date -u +%FT%TZ) $vendor stage 4 complete"
