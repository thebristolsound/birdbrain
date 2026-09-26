#!/usr/bin/env bash
# Decide from the API alone whether this fire has anything to do.
#
# The full cycle costs a toolchain install and a Claude session. Most hours it
# would find the slot occupied with nothing owed and exit, so this step asks
# the cheap version of the skill's sections 1 to 3 first and skips the rest when
# every answer is "nothing". It never writes. It is deliberately conservative:
# any doubt reads as "run", because a missed cycle costs an hour and a spurious
# one costs minutes.
#
# The conservative default is not enough on its own, because three of the
# answers here can be wrong in the direction that never runs. A stale claim is
# only aged out by the routine this step gates, a pre-pass this run's own
# cleanup failed is not a verdict, and an issue behind an open dependency is not
# work. Each is handled below.
#
# $1 = mode. report mode always runs; it exists to compare a runner's
# classification against an interactive session's.
# Env: GH_TOKEN (machine token), LOGIN (machine login, optional).
# Output: run=true|false, reason.
set -euo pipefail

# shellcheck source=.github/scripts/dispatch/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
mode="${1:-cycle}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
# Empty when this step runs outside the workflow; an empty login matches no
# author, so the pipeline filter below degrades to the unfiltered behaviour.
me="${LOGIN:-}"
# One slot, and only hand-picked work fills it (ADR-0028). Keep both in step with
# sections 1 and 3 of .claude/skills/dispatch/SKILL.md.
capacity=1
stale_before="$(date -u -d "$CLAIM_MAX_AGE" +%FT%TZ)"

decide() {
  echo "run=$1" >> "$out"
  echo "reason=$2" >> "$out"
  echo "Pre-gate: run=$1 ($2)" | tee -a "$summary"
  exit 0
}

[ "$mode" = report ] && decide true "report mode always runs"

# One array per page from --paginate; slurp and merge so a second page is not lost (#959).
list() { gh api --paginate "$1" | jq -s 'add // []'; }

# When label $2 (default agent-wip) was last applied, or empty when no such event survives.
labelled_at() {
  gh api --paginate "repos/$R/issues/$1/events?per_page=100" \
    | jq -s -r --arg label "${2:-agent-wip}" 'add // [] | [.[] | select(.event == "labeled" and .label.name == $label) | .created_at] | max // empty'
}

# Newest comment, review comment or review on a PR, ignoring $2's authorship.
newest_activity() {
  {
    gh api --paginate "repos/$R/issues/$1/comments?per_page=100" \
      | jq -r --arg me "$2" '.[] | select(.user.login != $me) | .created_at'
    gh api --paginate "repos/$R/pulls/$1/comments?per_page=100" \
      | jq -r --arg me "$2" '.[] | select(.user.login != $me) | .created_at'
    gh api --paginate "repos/$R/pulls/$1/reviews?per_page=100" \
      | jq -r --arg me "$2" '.[] | select(.user.login != $me) | .submitted_at // empty'
  } | sort | tail -1
}

prs="$(list "repos/$R/issues?state=open&labels=agent-pr&per_page=100" | jq '[.[] | select(.pull_request) | .number]')"
wip="$(list "repos/$R/issues?state=open&labels=agent-wip&per_page=100" | jq '[.[] | select(.pull_request | not) | .number]')"
occupancy=$(( $(jq length <<<"$prs") + $(jq length <<<"$wip") ))
echo "Occupancy $occupancy/$capacity: agent-pr PRs $prs, agent-wip claims $wip" | tee -a "$summary"

# Section 1: a claim past the 4-hour expiry is stale, and only the routine ages
# it out. Counting it as a held slot lets an abandoned claim declare the
# queue full for good, with the one component that could clear them gated off.
for n in $(jq -r '.[]' <<<"$wip"); do
  claimed="$(labelled_at "$n")"
  if [ -z "$claimed" ] || [[ ! "$claimed" > "$stale_before" ]]; then
    decide true "issue #$n holds an agent-wip claim from ${claimed:-an unrecorded time}, past the 4-hour expiry; section 1 must age it out"
  fi
done

# Section 2: does any open agent PR need the routine?
for n in $(jq -r '.[]' <<<"$prs"); do
  pr="$(gh api "repos/$R/pulls/$n")"
  sha="$(jq -r .head.sha <<<"$pr")"
  draft="$(jq -r .draft <<<"$pr")"
  st="$(gh api "repos/$R/commits/$sha/status" \
    --jq '[.statuses[] | select(.context=="agent/pre-pass")][0] // {}
          | "\(.state // "absent")\t\(.description // "")"')"
  IFS=$'\t' read -r state desc <<<"$st"
  case "$state" in
    success) ;;
    # cleanup.sh posts failure on a pre-pass its own run interrupted, and posts
    # no verdict comment with it. Read as a verdict, that failure is terminal
    # and the review is never retried, so a non-evidence PR can never earn the
    # success section 2a requires.
    failure)
      if [[ "$desc" == "$CLEANUP_FAILURE_PREFIX"* ]]; then
        decide true "PR #$n head ${sha:0:8} has a pre-pass an earlier run interrupted; the review is owed a retry"
      fi
      ;;
    *) decide true "PR #$n head ${sha:0:8} has agent/pre-pass=$state; a verdict is owed" ;;
  esac
  labels="$(gh api "repos/$R/issues/$n/labels" --jq '[.[].name]')"
  # A PR the skill parked for the maintainer moves only when someone other than
  # the pipeline acts on it. Without this, the failure-verdict rule below reads
  # the pipeline's own verdict comment as activity and runs a full cycle every
  # fire (#1460). A parked PR with no surviving label event falls through to the
  # unlabelled rules.
  if jq -e --arg l "$AWAITING_MAINTAINER_LABEL" 'index($l)' <<<"$labels" >/dev/null; then
    parked_at="$(labelled_at "$n" "$AWAITING_MAINTAINER_LABEL")"
    if [ -n "$parked_at" ]; then
      newest="$(newest_activity "$n" "$me")"
      if [ -n "$newest" ] && [[ "$newest" > "$parked_at" ]]; then
        decide true "PR #$n is parked for the maintainer and has activity at $newest newer than the label ($parked_at)"
      fi
      echo "PR #$n is parked for the maintainer since $parked_at with no activity after it; skipped" >> "$summary"
      continue
    fi
  fi
  head_at="$(gh api "repos/$R/commits/$sha" --jq .commit.committer.date)"
  # On a success verdict the pipeline's own comment is necessarily newer than
  # the head, and the skill classifies pipeline-authored activity as
  # non-actionable. Counting it would run a full cycle every fire against an
  # evidence PR that is only waiting on a human, which cannot auto-merge and so
  # never stops. On a failure verdict the fix round is still owed, so nothing is
  # filtered there.
  if [ "$state" = success ]; then
    newest="$(newest_activity "$n" "$me")"
  else
    newest="$(newest_activity "$n" "")"
  fi
  if [ -n "$newest" ] && [[ "$newest" > "$head_at" ]]; then
    decide true "PR #$n has activity at $newest newer than its head ($head_at)"
  fi
  if [ "$state" = success ] && [ "$draft" = false ]; then
    if ! jq -e 'index("evidence-affecting")' <<<"$labels" >/dev/null; then
      decide true "PR #$n is approved, ready and non-evidence; section 2a may merge it"
    fi
  fi
done

# Section 3: is there room, and anything to put in it?
if [ "$occupancy" -lt "$capacity" ]; then
  # Section 3 rejects a candidate whose native blocked_by dependencies are not
  # all closed, and rejecting it changes no label, so a frontier counted without
  # that query repeats a full install and Claude session every fire for work the
  # routine will refuse. A failed or unsupported dependency read counts the
  # issue as available, which is the conservative direction.
  frontier=0
  for n in $(list "repos/$R/issues?state=open&labels=ready-for-agent,queued&per_page=100" \
      | jq -r '.[] | select(.pull_request | not) | select(.assignees | length == 0)
               | select([.labels[].name] | index("process") | not) | .number'); do
    blockers="$(gh api "repos/$R/issues/$n/dependencies/blocked_by" \
      --jq '[.[] | select(.state == "open")] | length' 2>/dev/null || echo 0)"
    if [ "${blockers:-0}" -eq 0 ]; then
      frontier=$(( frontier + 1 ))
    else
      echo "Issue #$n is behind $blockers open dependency/dependencies; not frontier" >> "$summary"
    fi
  done
  if [ "$frontier" -gt 0 ]; then
    decide true "the slot is free and $frontier unblocked queued issue(s) wait"
  fi
  decide false "the slot is free but the queue is empty"
fi

decide false "the slot is held and no open agent PR needs the routine"
