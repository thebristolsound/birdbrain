#!/usr/bin/env bash
# Leave no state behind that a later cycle would wait on (#1141, #1057).
#
# Runs with if: always(). Three things a run can leave when it is cancelled,
# times out, or fails between a write and its counterpart:
#
#   1. An agent/pre-pass=pending it posted before spawning the reviewer. The
#      skill's rule is "never leave a sha without a status"; post failure naming
#      this run. Only the dispatcher's own pending text is touched, never the
#      seed from pre-pass-gate.yml and never a verdict.
#   2. A "Cycle claim: PR #n" comment with no "Cycle release: PR #n" after it.
#      Post the release; an unreleased claim costs a peer four hours.
#   3. A dispatch claim (agent-wip applied during this run) with no PR, when the
#      job did not succeed. Remove the label and say why. On a successful job the
#      routine's own give-up or PR-open path owns this label, so leave it.
#
# Env: GH_TOKEN (machine token), STARTED, LOGIN, JOB_STATUS, RUN_URL.
set -euo pipefail

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
: "${STARTED:?}" "${LOGIN:?}"
run_url="${RUN_URL:-<unknown run>}"
job_status="${JOB_STATUS:-unknown}"
PENDING_TEXT='Reviewer pre-pass running.'

note() { echo "Cleanup: $*" | tee -a "$summary"; }

prs="$(gh api --paginate "repos/$R/issues?state=open&labels=agent-pr&per_page=100" \
  | jq -s -r 'add // [] | .[] | select(.pull_request) | .number')"

for n in $prs; do
  pr="$(gh api "repos/$R/pulls/$n")"
  sha="$(jq -r .head.sha <<<"$pr")"

  # 1. Pending status this run posted.
  st="$(gh api "repos/$R/commits/$sha/status" \
    --jq '[.statuses[] | select(.context=="agent/pre-pass")][0] // {} | "\(.state)\t\(.description)\t\(.updated_at)"')"
  IFS=$'\t' read -r state desc updated <<<"$st"
  if [ "$state" = pending ] && [ "$desc" = "$PENDING_TEXT" ] && [[ "$updated" > "$STARTED" ]]; then
    gh api "repos/$R/statuses/$sha" -f state=failure -f context='agent/pre-pass' \
      -f description="Dispatch run ended ($job_status) before the pre-pass reported." \
      -f target_url="$run_url" >/dev/null
    note "PR #$n ${sha:0:8}: agent/pre-pass pending from this run -> failure"
  fi

  # 2. Cycle claim on the linked issue without a release.
  issue="$(jq -r '(.body // "" | split("\n")[0] | capture("Closes #(?<n>[0-9]+)") // {}).n // empty' <<<"$pr")"
  [ -n "$issue" ] || continue
  comments="$(gh api --paginate "repos/$R/issues/$issue/comments?per_page=100" | jq -s 'add // []')"
  claim="$(jq -r --arg login "$LOGIN" --arg since "$STARTED" --arg pr "$n" \
    '[.[] | select(.user.login == $login and .created_at >= $since)
          | select(.body | startswith("Cycle claim: PR #" + $pr))] | last | .created_at // empty' <<<"$comments")"
  [ -n "$claim" ] || continue
  released="$(jq -r --arg after "$claim" --arg pr "$n" \
    '[.[] | select(.created_at > $after) | select(.body | startswith("Cycle release: PR #" + $pr))] | length' <<<"$comments")"
  if [ "$released" -eq 0 ]; then
    printf 'Cycle release: PR #%s\nReleased by the dispatch run cleanup step; the run ended (%s) before the cycle did. %s\n' \
      "$n" "$job_status" "$run_url" > .dispatch-release.md
    gh api "repos/$R/issues/$issue/comments" -X POST -F body=@.dispatch-release.md >/dev/null
    rm -f .dispatch-release.md
    note "issue #$issue: released cycle claim on PR #$n taken at $claim"
  fi
done

# 3. Dispatch claims left by a run that did not succeed.
if [ "$job_status" != success ]; then
  for n in $(gh api --paginate "repos/$R/issues?state=open&labels=agent-wip&per_page=100" \
      | jq -s -r 'add // [] | .[] | select(.pull_request | not) | .number'); do
    labelled_at="$(gh api --paginate "repos/$R/issues/$n/events?per_page=100" \
      | jq -s -r 'add // [] | [.[] | select(.event == "labeled" and .label.name == "agent-wip") | .created_at] | max // empty')"
    if [ -n "$labelled_at" ] && [[ "$labelled_at" > "$STARTED" ]]; then
      printf 'Claim cleared: the dispatch run that took it ended (%s) before opening a PR. %s\n' \
        "$job_status" "$run_url" > .dispatch-clear.md
      gh api "repos/$R/issues/$n/comments" -X POST -F body=@.dispatch-clear.md >/dev/null
      gh api "repos/$R/issues/$n/labels/agent-wip" -X DELETE >/dev/null
      rm -f .dispatch-clear.md
      note "issue #$n: cleared dispatch claim taken at $labelled_at"
    fi
  done
fi

note "done (job status $job_status)"
