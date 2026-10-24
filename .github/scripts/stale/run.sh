#!/usr/bin/env bash
# Weekly pass over the open issues the machine account (birdbrain-agent) filed: ADR-0028 rule 4,
# as amended by ADR-0053. An issue with no activity for 7 days gets the `stale` label and a
# warning comment; a warned issue nobody has touched since closes as not planned at the next
# run. An issue carrying an exempt label is never warned or closed, and activity after a warning
# takes the label off again.
#
# Why the exemptions: on 2026-10-23 the 176 issues this workflow had closed included 36
# `evidence-affecting` ones (one `security`), 10 waiting on the maintainer and 42 nobody had
# triaged. Their 14 quiet days measured the maintainer's attention, not whether the defect was
# real.
#
# Env in: GH_TOKEN (github.token, issues: write), GITHUB_REPOSITORY, DRY_RUN (`true` prints the
# plan and writes nothing; anything else acts). Uses only `gh api`, so the test stubs one command.
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
dry_run="${DRY_RUN:-true}"
creator='birdbrain-agent'
label='stale'
exempt=(queued agent-wip evidence-affecting security court-admissibility blocker
  severity:blocking ready-for-human needs-triage)

now="$(date -u +%s)"
warn_before=$((now - 7 * 86400))
# Runs are a week apart but start minutes apart, so a warning from the previous run can be a
# little under 7 days old; 6 days still closes it on the next run and never on the same one.
close_before=$((now - 6 * 86400))
# Applying the label updates the issue's updated_at a moment after the label event; activity
# later than this after the label is someone touching the issue.
grace=120

epoch() { date -u -d "$1" +%s; }

is_exempt() {
  local labels=",$1," name
  for name in "${exempt[@]}"; do
    case "$labels" in *",$name,"*) return 0 ;; esac
  done
  return 1
}

act() {
  echo "$*"
  if [ "$dry_run" != true ]; then "$@" > /dev/null; fi
}

# shellcheck disable=SC2016 # the backticks are Markdown in the comment body
warn_body='This issue was filed by the machine account and has had no activity for 7 days. The stale-agent-issues workflow closes it as not planned at its next weekly run unless someone comments on it or applies `queued` or another exempt label (ADR-0053).'
# shellcheck disable=SC2016
close_body='Closed as not planned by the stale-agent-issues workflow: filed by the machine account, warned at the previous weekly run, and untouched since (ADR-0028, as amended by ADR-0053).

Reopen it and apply `queued` to put it on the dispatch list.'

if [ "$dry_run" != true ] && ! gh api "repos/$repo/labels/$label" > /dev/null 2>&1; then
  gh api -X POST "repos/$repo/labels" -f name="$label" -f color=cfd3d7 \
    -f description='No activity for 7 days; closes at the next weekly run (ADR-0053)' > /dev/null
fi

issues="$(gh api --paginate "repos/$repo/issues?state=open&creator=$creator&per_page=100" \
  --jq '.[] | select(.pull_request | not) | [.number, .updated_at, ([.labels[].name] | join(","))] | @tsv')"

warned=0 closed=0 cleared=0
while IFS=$'\t' read -r number updated labels; do
  [ -n "$number" ] || continue
  has_label=false
  case ",$labels," in *",$label,"*) has_label=true ;; esac

  if is_exempt "$labels"; then
    if [ "$has_label" = true ]; then
      act gh api -X DELETE "repos/$repo/issues/$number/labels/$label"
      cleared=$((cleared + 1))
    fi
    continue
  fi

  if [ "$has_label" = true ]; then
    labelled_at="$(gh api --paginate "repos/$repo/issues/$number/events" \
      --jq ".[] | select(.event == \"labeled\" and .label.name == \"$label\") | .created_at" |
      tail -n 1)"
    # A label with no labeled event to date it is not one this workflow can time; leave it.
    [ -n "$labelled_at" ] || continue
    labelled="$(epoch "$labelled_at")"
    if [ "$(epoch "$updated")" -gt $((labelled + grace)) ]; then
      act gh api -X DELETE "repos/$repo/issues/$number/labels/$label"
      cleared=$((cleared + 1))
    elif [ "$labelled" -lt "$close_before" ]; then
      act gh api -X POST "repos/$repo/issues/$number/comments" -f body="$close_body"
      act gh api -X PATCH "repos/$repo/issues/$number" -f state=closed -f state_reason=not_planned
      closed=$((closed + 1))
    fi
    continue
  fi

  if [ "$(epoch "$updated")" -lt "$warn_before" ]; then
    # Comment before labelling, so the label event is the last write and updated_at matches it.
    act gh api -X POST "repos/$repo/issues/$number/comments" -f body="$warn_body"
    act gh api -X POST "repos/$repo/issues/$number/labels" -f "labels[]=$label"
    warned=$((warned + 1))
  fi
done <<< "$issues"

summary="warned $warned, closed $closed, cleared $cleared"
if [ "$dry_run" = true ]; then summary="$summary (dry run: nothing written)"; fi
echo "$summary"
