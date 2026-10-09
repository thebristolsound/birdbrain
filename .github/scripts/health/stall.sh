#!/usr/bin/env bash
# Stall checks for the agent pipeline: work that should be moving and is not
# while every run stays green. check.sh's failure streaks cannot see this,
# because an idle or capped dispatch fire exits green at the pre-gate. Three
# rules, chosen by the maintainer on 2026-10-09:
#
#   1. An agent PR holds a slot and nothing has touched it for UNTOUCHED_HOURS.
#   2. A PR waits on the maintainer (parked, or labelled merge and not merged)
#      for more than WAITING_HOURS.
#   3. A slot is free, a queued issue has waited NO_DISPATCH_HOURS, and no
#      dispatch cycle reached its Claude step in that time.
#
# Prints one finding per line on stdout. A read that fails is itself a finding,
# so a broken check does not read as a quiet pipeline. Findings carry only
# stable timestamps (label and update times), because alert.sh comments on the
# alert issue whenever a finding line changes.
#
# Env in: GH_TOKEN (github.token: issues, pull-requests and actions read),
#         GITHUB_REPOSITORY.
set -euo pipefail

# shellcheck source=.github/scripts/dispatch/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/../dispatch/lib.sh"

UNTOUCHED_HOURS=24
WAITING_HOURS=24
NO_DISPATCH_HOURS=12
# ADR-0045's two slots, and the first dispatch step that calls Claude; both are
# pregate.sh's (capacity, CAP_PAID_STEP).
CAPACITY=2
PAID_STEP='Claude credential'
MERGE_LABEL=merge

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
hours_ago() { date -u -d "$1 hours ago" +%FT%TZ; }

# When label $2 last went on issue or PR $1, or nothing if it never did.
labelled_at() {
  list "repos/$R/issues/$1/events?per_page=100" \
    | jq -r --arg l "$2" '[.[] | select(.event == "labeled" and .label.name == $l)
      | .created_at] | max // empty'
}

# Rule 1. updated_at moves on a push, comment, review or label change. A parked
# PR is rule 2's.
untouched() {
  jq -r --arg park "$AWAITING_MAINTAINER_LABEL" --arg before "$(hours_ago "$UNTOUCHED_HOURS")" \
    --arg R "$R" '.[]
    | select(any(.labels[]; .name == "agent-pr") and all(.labels[]; .name != $park))
    | select(.updated_at < $before)
    | "PR #\(.number) holds an agent slot and has had no push, comment, review or label change since \(.updated_at); https://github.com/\($R)/pull/\(.number)"' \
    <<<"$pulls"
}

# Rule 2.
waiting() {
  local before n at
  before="$(hours_ago "$WAITING_HOURS")"
  for n in $(jq -r --arg l "$AWAITING_MAINTAINER_LABEL" \
    '.[] | select(any(.labels[]; .name == $l)) | .number' <<<"$pulls"); do
    at="$(labelled_at "$n" "$AWAITING_MAINTAINER_LABEL")" || return 1
    if [ -n "$at" ] && [[ "$at" < "$before" ]]; then
      echo "PR #$n has been parked $AWAITING_MAINTAINER_LABEL for you since $at; remove the label to wake it: https://github.com/$R/pull/$n"
    fi
  done
  for n in $(jq -r --arg l "$MERGE_LABEL" \
    '.[] | select(any(.labels[]; .name == $l)) | .number' <<<"$pulls"); do
    at="$(labelled_at "$n" "$MERGE_LABEL")" || return 1
    if [ -n "$at" ] && [[ "$at" < "$before" ]]; then
      echo "PR #$n has carried the $MERGE_LABEL label since $at and has not merged; check its merge-gate check: https://github.com/$R/pull/$n/checks"
    fi
  done
}

# Rule 3, counted the way pregate.sh counts slots and the frontier, minus the
# trust rules: an alert can afford to read labels as they stand.
free_slot() {
  local state since claim_after held wip live=0 occupancy queued n at frontier="" blockers runs id paid
  state="$(gh api "repos/$R/actions/workflows/dispatch.yml" --jq .state)" || return 1
  # A dispatch the owner disabled is a chosen pause, as in check.sh's streaks.
  [ "$state" = disabled_manually ] && return 0
  since="$(hours_ago "$NO_DISPATCH_HOURS")"
  claim_after="$(date -u -d "$CLAIM_MAX_AGE" +%FT%TZ)"

  # Issues an open agent PR works, from its agent/<n>-<slug> branch.
  held="$(jq -c '[.[] | select(any(.labels[]; .name == "agent-pr")) | (.head.ref // "")
    | capture("^agent/(?<n>[0-9]+)-") | .n | tonumber]' <<<"$pulls")" || return 1
  occupancy="$(jq '[.[] | select(any(.labels[]; .name == "agent-pr"))] | length' <<<"$pulls")" \
    || return 1
  wip="$(list "repos/$R/issues?state=open&labels=agent-wip&per_page=100" \
    | jq -r '.[] | select(.pull_request | not) | .number')" || return 1
  for n in $wip; do
    jq -e --argjson n "$n" 'index($n)' <<<"$held" >/dev/null && continue
    at="$(labelled_at "$n" agent-wip)" || return 1
    if [ -n "$at" ] && [[ ! "$at" < "$claim_after" ]]; then
      live=$(( live + 1 ))
    fi
  done
  occupancy=$(( occupancy + live ))
  [ "$occupancy" -lt "$CAPACITY" ] || return 0

  queued="$(list "repos/$R/issues?state=open&labels=queued,ready-for-agent&per_page=100" \
    | jq -r '.[] | select((.pull_request | not) and (.assignees | length == 0)
      and all(.labels[]; .name != "process" and .name != "agent-wip")) | .number')" || return 1
  for n in $queued; do
    jq -e --argjson n "$n" 'index($n)' <<<"$held" >/dev/null && continue
    at="$(labelled_at "$n" queued)" || return 1
    if [ -z "$at" ] || [[ ! "$at" < "$since" ]]; then
      continue
    fi
    # A failed dependency read counts the issue as available, as in pregate.sh.
    blockers="$(gh api "repos/$R/issues/$n/dependencies/blocked_by" \
      --jq '[.[] | select(.state == "open")] | length' 2>/dev/null || echo 0)"
    [ "${blockers:-0}" -eq 0 ] && frontier="$frontier #$n"
  done
  [ -n "$frontier" ] || return 0

  runs="$(gh api "repos/$R/actions/workflows/dispatch.yml/runs?per_page=100" \
    --jq "[.workflow_runs[] | select(.updated_at >= \"$since\") | .id] | .[]")" || return 1
  for id in $runs; do
    paid="$(gh api --paginate "repos/$R/actions/runs/$id/jobs?filter=all&per_page=100" \
      | jq -s --arg step "$PAID_STEP" --arg since "$since" '[.[].jobs[].steps[]?
        | select(.name == $step)
        | select(.status == "in_progress" or (.status == "completed" and .conclusion != "skipped"))
        | select((.started_at // $since) >= $since)] | length')" || return 1
    [ "$paid" -gt 0 ] && return 0
  done
  echo "A slot is free ($occupancy of $CAPACITY held) and queued issue(s)$frontier have waited more than $NO_DISPATCH_HOURS hours, but no dispatch cycle has reached its Claude step in that time; each run's step summary gives the pre-gate's reason: https://github.com/$R/actions/workflows/dispatch.yml"
}

if ! pulls="$(list "repos/$R/pulls?state=open&per_page=100")"; then
  echo 'Stall check could not list the open PRs, so none of its rules ran'
  exit 0
fi
untouched || echo 'Stall check could not finish the untouched-agent-PR rule'
waiting || echo 'Stall check could not read the label events for the waiting-on-you rule'
free_slot || echo 'Stall check could not read the claims, queue or dispatch runs for the free-slot rule'
