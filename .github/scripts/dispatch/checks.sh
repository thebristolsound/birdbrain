#!/usr/bin/env bash
# The CI state of an agent PR's head, counting only what can be trusted (#1310).
#
# Section 4 of the dispatch skill hands a red check to a paid fix round, and
# waits on a running one. `gh pr checks` lists every check run on the head, and
# a workflow on any pushed branch can create one there under any name: its
# GITHUB_TOKEN is the GitHub Actions app's, the same app CI reports as, and
# `checks: write` lets it create a check run for any commit. So a check run
# counts here only when it is a job of a workflow run GitHub started for this PR
# against main at this head, which a check run created through the API is not.
# A status counts only from the maintainer or the pipeline (trusted_statuses);
# agent/pre-pass is the verdict, not CI, and is left out.
#
# Usage: checks.sh [--wait <seconds>] <pr-number>. Env: GH_TOKEN, LOGIN (machine
# login, optional).
# Output: {sha, failing, pending, passed, skipped, ignored}: check names, and one
# line per check run or status not counted.
#
# --wait re-reads every 30 seconds (CHECKS_POLL_SECONDS) until `pending` is empty or the seconds run out,
# then prints the last read. Exit 0 when nothing is pending, 124 when the wait ran
# out with checks still pending. A cycle polled with its own loop instead, and run
# 37129293732 spent nine minutes in one that could not parse this output. Keep the
# wait under the Bash tool's ten-minute cap.
set -euo pipefail
# read_checks runs inside $(...), where bash otherwise drops -e and a failed read would
# print a partial result with exit 0.
shopt -s inherit_errexit

# shellcheck source=.github/scripts/dispatch/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
wait=0
if [ "${1:-}" = --wait ]; then
  wait="${2:?usage: checks.sh [--wait <seconds>] <pr-number>}"
  shift 2
fi
n="${1:?usage: checks.sh [--wait <seconds>] <pr-number>}"
me="${LOGIN:-}"

read_checks() {
  sha="$(gh api "repos/$R/pulls/$n" --jq .head.sha)"
  runs="$(gh api --paginate "repos/$R/actions/runs?head_sha=$sha&event=pull_request&per_page=100" \
    --jq ".workflow_runs[] | select(any(.pull_requests[]?; .number == $n and .base.ref == \"main\")) | .id")"
  jobs='[]'
  for id in $runs; do
    jobs="$(gh api --paginate "repos/$R/actions/runs/$id/jobs?per_page=100" --jq '.jobs[].id' \
      | jq -s --argjson have "$jobs" '$have + .')"
  done
  check_runs="$(gh api --paginate "repos/$R/commits/$sha/check-runs?per_page=100" \
    --jq '.check_runs[] | {id, name, status, conclusion, app: (.app.slug // "")}' | jq -s .)"
  statuses="$(trusted_statuses "$R" "$sha" "$me")"

  jq -n -c --arg sha "$sha" --argjson jobs "$jobs" --argjson runs "$check_runs" \
    --argjson st "$statuses" '
    def bad: ["failure", "cancelled", "timed_out", "action_required"];
    ($runs | map(.counted = (.app == "github-actions" and (.id as $id | $jobs | index($id)))))
      as $runs
    | ($st | del(.["agent/pre-pass"]) | to_entries) as $st
    | [$runs[] | select(.counted) | {name, state: (if .status != "completed" then "pending"
          elif (.conclusion as $c | bad | index($c)) then "failing"
          elif .conclusion == "skipped" then "skipped" else "passed" end)}]
      + [$st[] | select(.value.state != "absent") | {name: .key, state: (.value.state
          | if . == "pending" then "pending" elif . == "success" then "passed" else "failing" end)}]
    | . as $all
    | {sha: $sha}
      + (["failing", "pending", "passed", "skipped"] | map({(.): (. as $s | [$all[] | select(.state == $s)
          | .name] | unique)}) | add)
      + {ignored: ([$runs[] | select(.counted | not)
          | "check run \(.name) (\(if .app == "" then "no app" else .app end), \(.id)):"
            + " not a job of the latest workflow runs for this PR"]
        + [$st[] | .key as $c | .value.ignored[]
          | "status \($c) \(.state) by \(if .by == "" then "an unrecorded account" else .by end) at \(.at)"])}'
}

deadline=$((SECONDS + wait))
while :; do
  out="$(read_checks)"
  if [ "$(jq '.pending | length' <<< "$out")" -eq 0 ]; then
    printf '%s\n' "$out"
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    printf '%s\n' "$out"
    [ "$wait" -eq 0 ] && exit 0
    exit 124
  fi
  sleep "${CHECKS_POLL_SECONDS:-30}"
done
