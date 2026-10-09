#!/usr/bin/env bash
# The spend cap's counter, shared by every pre-gate that bounds paid runs: dispatch
# (pregate.sh here) and the scheduled PR review (.github/scripts/pr-review/pregate.sh).
# Each caller counts only its own workflow's runs, so each cap is separate.
#
# The caller sets R, CAP_WORKFLOW, CAP_PAID_STEP, CAP_TARGET_TITLE, cap_total_since,
# cap_target_since and cap_rerun_since, and sources lib.sh for list().

# Every paid cycle in the CAP_WORKFLOW runs GitHub still lists, started since
# cap_total_since, one per job (attempt), as [{at, targets}]: when its
# CAP_PAID_STEP started, and the numbers in its CAP_TARGET_TITLE annotations, or
# null when it has none (a job from before the cap, which then counts against
# every target). A skipped step never started; a cancelled one did. Fails on any
# failed read, and the caller holds.
# shellcheck disable=SC2154 # the caller sets the cap_*_since times, see above
paid_cycles() {
  local page=1 runs ids="" batch id jobs found="" job at notes targets cycles=""
  while :; do
    runs="$(gh api "repos/$R/actions/workflows/$CAP_WORKFLOW/runs?per_page=100&page=$page")" \
      || return 1
    # A run's newest attempt can be in the window while the run was created
    # before it, so a run with more than one attempt is read whatever its times.
    batch="$(jq -r --arg since "$cap_total_since" '.workflow_runs[]
      | select(.updated_at >= $since or (.run_started_at // "") >= $since or .run_attempt > 1)
      | .id' <<<"$runs")" || return 1
    ids="$ids $batch"
    [ "$(jq '.workflow_runs | length' <<<"$runs")" -eq 100 ] || break
    jq -e --arg after "$cap_rerun_since" 'any(.workflow_runs[]; .created_at >= $after)' \
      <<<"$runs" >/dev/null || break
    page=$(( page + 1 ))
  done
  for id in $ids; do
    jobs="$(gh api --paginate "repos/$R/actions/runs/$id/jobs?filter=all&per_page=100")" \
      || return 1
    batch="$(jq -s -r --arg step "$CAP_PAID_STEP" --arg since "$cap_total_since" \
      --arg now "$(date -u +%FT%TZ)" '.[].jobs[] | . as $j | .steps[]? | select(.name == $step)
        | select(.status == "in_progress" or (.status == "completed" and .conclusion != "skipped"))
        | (.started_at // $j.started_at // $now) as $at | select($at >= $since)
        | "\($j.check_run_url | sub(".*/"; ""))\t\($at)"' <<<"$jobs")" || return 1
    found="$found$batch"$'\n'
  done
  while IFS=$'\t' read -r job at; do
    [ -n "$job" ] || continue
    targets=null
    if [[ ! "$at" < "$cap_target_since" ]]; then
      notes="$(list "repos/$R/check-runs/$job/annotations?per_page=100")" || return 1
      targets="$(jq -c --arg title "$CAP_TARGET_TITLE" '[.[] | select(.title == $title) | .message]
        | if length == 0 then null else [.[] | scan("[0-9]+") | tonumber] end' <<<"$notes")" \
        || return 1
    fi
    cycles="$cycles$(jq -n -c --arg at "$at" --argjson t "$targets" '{at: $at, targets: $t}')" \
      || return 1
    cycles="$cycles"$'\n'
  done <<<"$found"
  jq -s -c . <<<"$cycles"
}
