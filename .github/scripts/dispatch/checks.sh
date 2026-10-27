#!/usr/bin/env bash
# The CI state of an agent PR's head, counting only what can be trusted (#1310).
#
# Section 4 of the dispatch skill hands a red check to a paid fix round, and
# waits on a running one. `gh pr checks` lists every check run on the head, and
# a workflow on any pushed branch can create one there under any name: its
# GITHUB_TOKEN is the GitHub Actions app's, the same app CI reports as, and
# `checks: write` lets it create a check run for any commit. So a check run
# counts here only when it is a job of a workflow run GitHub started for this PR
# at this head and lists against the PR's current base, which a check run created
# through the API is not. GitHub lists the current base on runs that started
# before a retarget, so after one, CI that ran against the former base still
# counts until the next push.
# Only the newest such run of each workflow counts: an older run at the same head
# (superseded, often cancelled) left red jobs beside the newer run's green ones.
# A status counts only from the maintainer or the pipeline (trusted_statuses);
# agent/pre-pass is the verdict, not CI, and is left out. So is the merge-gate
# job (ADR-0041): its rule fails every agent PR until that verdict is success, so
# counting it would hold the verdict behind itself. The probe job of
# test-reliability.yml is advisory: the pre-pass reads its report, and the test
# pass runs the probe itself when the job did not succeed. Both are listed under
# ignored.
#
# When CI (ci.yml) has no run that GitHub lists for this PR at this head against
# its current base, `pending` holds one entry saying so, and --wait keeps waiting on
# it: an empty read is not a green. Another workflow's run is not enough, since
# merge-gate.yml also runs on `edited` and pre-pass-gate.yml on `labeled`, and
# neither event starts CI.
#
# Usage: checks.sh [--wait <seconds>] <pr-number>. Env: GH_TOKEN, LOGIN (machine
# login, optional).
# Output: {sha, failing, pending, passed, skipped, ignored}: check names, and one
# line per check run or status not counted.
#
# --wait re-reads every 30 seconds (CHECKS_POLL_SECONDS) until `pending` is empty or
# the seconds run out, then prints the last read. Exit 0 when nothing is pending,
# 124 when the wait ran out with checks still pending. No sleep runs past the
# deadline, so the command returns within the wait plus one read. A cycle polled
# with its own loop instead, and run 37129293732 spent nine minutes in one that
# could not parse this output. Keep the wait under the Bash tool's ten-minute cap.
set -euo pipefail
# read_checks runs inside $(...), where bash otherwise drops -e and a failed read would
# print a partial result with exit 0.
shopt -s inherit_errexit

# shellcheck source=.github/scripts/dispatch/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
ci_workflow=.github/workflows/ci.yml
wait=0
if [ "${1:-}" = --wait ]; then
  wait="${2:?usage: checks.sh [--wait <seconds>] <pr-number>}"
  shift 2
fi
n="${1:?usage: checks.sh [--wait <seconds>] <pr-number>}"
me="${LOGIN:-}"

read_checks() {
  pr="$(gh api "repos/$R/pulls/$n" --jq '{sha: .head.sha, base: .base.ref}')"
  sha="$(jq -r .sha <<< "$pr")"
  base="$(jq -r .base <<< "$pr")"
  # The base is filtered in the local jq, where --arg passes it as data: a branch name
  # spliced into gh's --jq filter would be read as jq code.
  kept="$(gh api --paginate "repos/$R/actions/runs?head_sha=$sha&event=pull_request&per_page=100" \
    --jq '.workflow_runs[] | {id, workflow_id, run_number, path, pull_requests}' \
    | jq -s -c --argjson n "$n" --arg base "$base" '
      map(select(any(.pull_requests[]?; .number == $n and .base.ref == $base)))
      | group_by(.workflow_id) | map(max_by(.run_number) | {id, path})')"
  runs="$(jq -r '.[].id' <<< "$kept")"
  ci="$(jq --arg ci "$ci_workflow" 'any(.[]; .path == $ci)' <<< "$kept")"
  jobs='[]'
  for id in $runs; do
    jobs="$(gh api --paginate "repos/$R/actions/runs/$id/jobs?per_page=100" --jq '.jobs[].id' \
      | jq -s --argjson have "$jobs" '$have + .')"
  done
  check_runs="$(gh api --paginate "repos/$R/commits/$sha/check-runs?per_page=100" \
    --jq '.check_runs[] | {id, name, status, conclusion, app: (.app.slug // "")}' | jq -s .)"
  statuses="$(trusted_statuses "$R" "$sha" "$me")"

  jq -n -c --arg sha "$sha" --arg base "$base" --argjson ci "$ci" --argjson jobs "$jobs" \
    --argjson runs "$check_runs" --argjson st "$statuses" '
    def bad: ["failure", "cancelled", "timed_out", "action_required"];
    ($runs | map(.why = (if .name == "merge-gate" then "reads the pre-pass verdict (ADR-0041), not CI"
          elif .name == "probe" then "the advisory test reliability probe, read by the pre-pass"
          elif .app == "github-actions" and (.id as $id | $jobs | index($id)) then null
          else "not a job of the latest workflow runs for this PR" end)))
      as $runs
    | ($st | del(.["agent/pre-pass"]) | to_entries) as $st
    | [$runs[] | select(.why == null) | {name, state: (if .status != "completed" then "pending"
          elif (.conclusion as $c | bad | index($c)) then "failing"
          elif .conclusion == "skipped" then "skipped" else "passed" end)}]
      + [$st[] | select(.value.state != "absent") | {name: .key, state: (.value.state
          | if . == "pending" then "pending" elif . == "success" then "passed" else "failing" end)}]
      + (if $ci then [] else [{name: "no CI run for this head against base \($base)",
          state: "pending"}] end)
    | . as $all
    | {sha: $sha}
      + (["failing", "pending", "passed", "skipped"] | map({(.): (. as $s | [$all[] | select(.state == $s)
          | .name] | unique)}) | add)
      + {ignored: ([$runs[] | select(.why != null)
          | "check run \(.name) (\(if .app == "" then "no app" else .app end), \(.id)): \(.why)"]
        + [$st[] | .key as $c | .value.ignored[]
          | "status \($c) \(.state) by \(if .by == "" then "an unrecorded account" else .by end) at \(.at)"])}'
}

deadline=$((SECONDS + wait))
poll="${CHECKS_POLL_SECONDS:-30}"
while :; do
  out="$(read_checks)"
  if [ "$(jq '.pending | length' <<< "$out")" -eq 0 ]; then
    printf '%s\n' "$out"
    exit 0
  fi
  remaining=$((deadline - SECONDS))
  if [ "$remaining" -le 0 ]; then
    printf '%s\n' "$out"
    [ "$wait" -eq 0 ] && exit 0
    exit 124
  fi
  # Never past the deadline: a full poll after a read at 539 of 540 seconds, then one
  # more read, is what overran the ten-minute cap.
  sleep "$(( remaining < poll ? remaining : poll ))"
done
