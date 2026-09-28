#!/usr/bin/env bash
# Decide from the API alone whether this fire has anything to do.
#
# The full cycle costs a toolchain install and a Claude session. Most hours it
# would find the slot occupied with nothing owed and exit, so this step asks
# the cheap version of the skill's sections 1 to 3 first and skips the rest when
# every answer is "nothing". It never writes. It is deliberately conservative:
# any doubt reads as "run", because a missed cycle costs an hour and a spurious
# one costs minutes. Who acted is the exception (#1310). None of these starts a
# cycle, however recent, and each is named in the step summary instead: a
# comment or review from outside the trust list below; a head anyone but the
# maintainer or the pipeline pushed; an agent-pr or agent-wip label, or the
# removal of awaiting-maintainer, by anyone but those two; and a ready-for-agent
# or queued label anyone but the maintainer applied.
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
# Empty when this step runs outside the workflow. Then nothing counts as the
# pipeline's own, so neither its comments nor the review bots' start a cycle.
me="${LOGIN:-}"
# The trust list, from the spend ruling on #1310: the maintainer, the pipeline
# itself, and the named review bots on a PR the pipeline opened. Everyone else,
# other collaborators included, is untrusted. "Session rules" in
# .claude/skills/dispatch/SKILL.md holds the same list, and claude.yml's
# include_comments_by_actor a third copy under GraphQL names; change all three.
# REST names the Copilot reviewer's inline comments `Copilot` and its reviews
# `copilot-pull-request-reviewer[bot]`.
maintainer='thebristolsound'
review_bots='["coderabbitai[bot]","chatgpt-codex-connector[bot]","Copilot","copilot-pull-request-reviewer[bot]"]'
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

# For the reasons a red main makes futile: a new verdict or a new dispatch only
# re-reports the red, which cost about a day of full cycles each time it
# happened. The reasons that still pay call decide directly.
unless_red() {
  if [ -n "$red" ]; then
    echo "Held while main is red: $1" | tee -a "$summary"
  else
    decide true "$1"
  fi
}

[ "$mode" = report ] && decide true "report mode always runs"

# One array per page from --paginate; slurp and merge so a second page is not lost (#959).
list() { gh api --paginate "$1" | jq -s 'add // []'; }

# Whether login $1 is the maintainer or, inside the workflow, the pipeline.
trusted_actor() { [ "$1" = "$maintainer" ] || { [ -n "$me" ] && [ "$1" = "$me" ]; }; }

# The newest $3 event (labeled or unlabeled) for label $2 on issue $1, as
# "<time><TAB><login>", or empty when no such event survives. The events API
# names who applied or removed a label; the labels on the issue do not.
label_event() {
  gh api --paginate "repos/$R/issues/$1/events?per_page=100" \
    | jq -s -r --arg label "$2" --arg ev "$3" \
      'add // [] | [.[] | select(.event == $ev and .label.name == $label)] | max_by(.created_at) // empty
        | "\(.created_at)\t\(.actor.login // "")"'
}

# When commit $2 was pushed to branch $1 and by whom, as "<time><TAB><login>",
# or empty when no push activity on the branch names it. A commit's author and
# committer are whatever the pusher wrote; the activity API records the account.
# The time comes first because read collapses a leading tab, so an entry with no
# actor would otherwise put the time in the login.
pushed_by() {
  list "repos/$R/activity?ref=refs/heads/$1&per_page=100" \
    | jq -r --arg sha "$2" '[.[] | select(.after == $sha)] | first // empty
        | "\(.timestamp)\t\(.actor.login // "")"'
}

# When label $2 (default agent-wip) was last applied, or empty when no such event survives.
labelled_at() {
  gh api --paginate "repos/$R/issues/$1/events?per_page=100" \
    | jq -s -r --arg label "${2:-agent-wip}" 'add // [] | [.[] | select(.event == "labeled" and .label.name == $label) | .created_at] | max // empty'
}

# Every comment, review comment and review on PR $1 as {login, at, trusted}.
# $2 is the PR's author: the review bots are trusted only when it is the pipeline.
activity() {
  local bots='[]'
  if [ -n "$me" ] && [ "$2" = "$me" ]; then bots="$review_bots"; fi
  {
    gh api --paginate "repos/$R/issues/$1/comments?per_page=100" \
      | jq -c '.[] | {login: .user.login, at: .created_at}'
    gh api --paginate "repos/$R/pulls/$1/comments?per_page=100" \
      | jq -c '.[] | {login: .user.login, at: .created_at}'
    gh api --paginate "repos/$R/pulls/$1/reviews?per_page=100" \
      | jq -c '.[] | select(.submitted_at) | {login: .user.login, at: .submitted_at}'
  } | jq -s -c --arg owner "$maintainer" --arg me "$me" --argjson bots "$bots" \
    'map(.login as $l
      | .trusted = ($l == $owner or ($me != "" and $l == $me) or any($bots[]; . == $l)))'
}

# The newest trusted timestamp in activity $1. $2 narrows it: "others" leaves
# out the pipeline's own activity, "maintainer" keeps only his.
newest_trusted() {
  jq -r --arg owner "$maintainer" --arg me "$me" --arg scope "$2" \
    '.[] | select(.trusted)
      | select(if $scope == "maintainer" then .login == $owner
               elif $scope == "others" then .login != $me
               else true end)
      | .at' <<<"$1" | sort | tail -1
}

# Name untrusted activity in $2 on PR $1 newer than $3. It is reported, never counted.
report_untrusted() {
  jq -r --arg pr "$1" --arg after "$3" \
    '[.[] | select((.trusted | not) and .at > $after) | "\(.login) at \(.at)"]
      | select(length > 0)
      | "PR #\($pr) has activity from outside the trust list, not counted: \(join(", "))"' \
    <<<"$2" >> "$summary"
}

prs="$(list "repos/$R/issues?state=open&labels=agent-pr&per_page=100" | jq '[.[] | select(.pull_request) | .number]')"
wip="$(list "repos/$R/issues?state=open&labels=agent-wip&per_page=100" | jq '[.[] | select(.pull_request | not) | .number]')"
occupancy=$(( $(jq length <<<"$prs") + $(jq length <<<"$wip") ))
echo "Occupancy $occupancy/$capacity: agent-pr PRs $prs, agent-wip claims $wip" | tee -a "$summary"

# Is main red? Red means a required check of the rules for main concluded
# failing at main's head; one still running does not. merge.sh reads the same
# rules, in node rather than jq, so the two copies are kept separate rather than
# sourced across the skill and workflow trees. A failed read counts as green,
# which is the conservative direction here.
red=""
failing='select(.status == "completed") | select(.conclusion as $c | ["failure", "cancelled", "timed_out", "action_required"] | index($c))'
if main_sha="$(gh api "repos/$R/commits/main" --jq .sha)" \
  && required="$(gh api "repos/$R/rules/branches/main" \
    --jq '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]')" \
  && failed_runs="$(gh api "repos/$R/commits/$main_sha/check-runs?per_page=100" --jq "[.check_runs[] | $failing | .name]")" \
  && failed_statuses="$(gh api "repos/$R/commits/$main_sha/status?per_page=100" \
    --jq '[.statuses[] | select(.state == "failure" or .state == "error") | .context]')"; then
  red="$(jq -n -r --argjson req "$required" --argjson runs "$failed_runs" --argjson st "$failed_statuses" \
    '$runs + $st | unique | map(select(. as $n | $req | index($n))) | join(", ")')"
else
  echo "Could not read the required checks on main; counting main as green" | tee -a "$summary"
fi
if [ -n "$red" ]; then
  echo "Main ${main_sha:0:8} is red: required check(s) $red failed. Verdicts owed and dispatch wait for a green main" | tee -a "$summary"
fi

# Section 1: a claim past the 4-hour expiry is stale, and only the routine ages
# it out. Counting it as a held slot lets an abandoned claim declare the
# queue full for good, with the one component that could clear them gated off.
# A label someone outside the trust list applied still holds the slot, but its
# age starts nothing. With the slot full that stalls the queue until the
# maintainer removes it, and only this step's summary names it.
for n in $(jq -r '.[]' <<<"$wip"); do
  claim="$(label_event "$n" agent-wip labeled)"
  IFS=$'\t' read -r claimed claimed_by <<<"$claim"
  if [ -n "$claimed" ] && ! trusted_actor "$claimed_by"; then
    echo "Issue #$n carries agent-wip from ${claimed_by:-an unrecorded account}, outside the trust list; not aged out" >> "$summary"
    continue
  fi
  if [ -z "$claimed" ] || [[ ! "$claimed" > "$stale_before" ]]; then
    decide true "issue #$n holds an agent-wip claim from ${claimed:-an unrecorded time}, past the 4-hour expiry; section 1 must age it out"
  fi
done

# Section 2: does any open agent PR need the routine? A PR counts only when the
# maintainer or the pipeline applied its agent-pr label. One labelled by anyone
# else still holds the slot, as it does in the skill, so it can block the queue
# but not start a cycle.
for n in $(jq -r '.[]' <<<"$prs"); do
  marked="$(label_event "$n" agent-pr labeled)"
  IFS=$'\t' read -r _ marked_by <<<"$marked"
  if ! trusted_actor "$marked_by"; then
    echo "PR #$n carries agent-pr from ${marked_by:-an unrecorded account}, outside the trust list; not worked" >> "$summary"
    continue
  fi
  pr="$(gh api "repos/$R/pulls/$n")"
  sha="$(jq -r .head.sha <<<"$pr")"
  draft="$(jq -r .draft <<<"$pr")"
  author="$(jq -r '.user.login // empty' <<<"$pr")"
  pushed_at=""
  untrusted_head=""
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
        unless_red "PR #$n head ${sha:0:8} has a pre-pass an earlier run interrupted; the review is owed a retry"
      fi
      ;;
    # A head someone outside the trust list pushed is owed nothing. From here on
    # only the maintainer's activity after that push moves the PR.
    *)
      push="$(pushed_by "$(jq -r .head.ref <<<"$pr")" "$sha")"
      IFS=$'\t' read -r pushed_at pusher <<<"$push"
      if trusted_actor "$pusher"; then
        unless_red "PR #$n head ${sha:0:8} has agent/pre-pass=$state; a verdict is owed"
      else
        untrusted_head=1
        echo "PR #$n head ${sha:0:8} was pushed by ${pusher:-an unrecorded account}, outside the trust list; no verdict owed" >> "$summary"
      fi
      ;;
  esac
  labels="$(gh api "repos/$R/issues/$n/labels" --jq '[.[].name]')"
  items="$(activity "$n" "$author")"
  # A PR the skill parked for the maintainer moves only when he acts on it. The
  # bots are ignored too: marking a PR ready wakes CodeRabbit, whose summary
  # would otherwise un-park it. Without this, the failure-verdict rule below reads
  # the pipeline's own verdict comment as activity and runs a full cycle every
  # fire (#1460). A parked PR with no surviving label event falls through to the
  # unlabelled rules. Removing the label un-parks the PR only when the maintainer
  # or the pipeline removed it. After anyone else removes it, the skill has no
  # label left to remove when the round resumes, so a head one of those two
  # pushed after the label stands in for that removal. Without it, the
  # maintainer's answer stays newer than the label and runs every fire.
  parked_at=""
  if jq -e --arg l "$AWAITING_MAINTAINER_LABEL" 'index($l)' <<<"$labels" >/dev/null; then
    parked_at="$(labelled_at "$n" "$AWAITING_MAINTAINER_LABEL")"
  else
    removal="$(label_event "$n" "$AWAITING_MAINTAINER_LABEL" unlabeled)"
    IFS=$'\t' read -r removed_at remover <<<"$removal"
    if [ -n "$removed_at" ] && ! trusted_actor "$remover"; then
      parked_at="$(labelled_at "$n" "$AWAITING_MAINTAINER_LABEL")"
      push="$(pushed_by "$(jq -r .head.ref <<<"$pr")" "$sha")"
      IFS=$'\t' read -r resumed_at resumed_by <<<"$push"
      removed="PR #$n: ${remover:-an unrecorded account} removed $AWAITING_MAINTAINER_LABEL at $removed_at, outside the trust list"
      if [ -n "$resumed_at" ] && trusted_actor "$resumed_by" && [[ "$resumed_at" > "$parked_at" ]]; then
        echo "$removed; resumed by a push at $resumed_at" >> "$summary"
        parked_at=""
      else
        echo "$removed; still parked" >> "$summary"
      fi
    fi
  fi
  if [ -n "$parked_at" ]; then
    report_untrusted "$n" "$items" "$parked_at"
    newest="$(newest_trusted "$items" maintainer)"
    if [ -n "$newest" ] && [[ "$newest" > "$parked_at" ]]; then
      decide true "PR #$n is parked for the maintainer and has activity at $newest newer than the label ($parked_at)"
    fi
    echo "PR #$n is parked for the maintainer since $parked_at with no activity after it; skipped" >> "$summary"
    continue
  fi
  head_at="$(gh api "repos/$R/commits/$sha" --jq .commit.committer.date)"
  report_untrusted "$n" "$items" "$head_at"
  if [ -n "$untrusted_head" ]; then
    since="${pushed_at:-$head_at}"
    newest="$(newest_trusted "$items" maintainer)"
    if [ -n "$newest" ] && [[ "$newest" > "$since" ]]; then
      decide true "PR #$n has activity from the maintainer at $newest newer than a push from outside the trust list ($since)"
    fi
    continue
  fi
  # On a success verdict the pipeline's own comment is necessarily newer than
  # the head, and the skill classifies pipeline-authored activity as
  # non-actionable. Counting it would run a full cycle every fire against an
  # evidence PR that is only waiting on a human, which cannot auto-merge and so
  # never stops. On a failure verdict the fix round is still owed, so the
  # pipeline's own verdict counts there.
  if [ "$state" = success ]; then
    newest="$(newest_trusted "$items" others)"
  else
    newest="$(newest_trusted "$items" all)"
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
    # Only the maintainer queues work: an issue counts when he applied both labels.
    foreign=""
    for l in ready-for-agent queued; do
      applied="$(label_event "$n" "$l" labeled)"
      IFS=$'\t' read -r _ by <<<"$applied"
      [ "$by" = "$maintainer" ] || foreign="${foreign:+$foreign, }$l from ${by:-an unrecorded account}"
    done
    if [ -n "$foreign" ]; then
      echo "Issue #$n has $foreign, outside the trust list; not frontier" >> "$summary"
      continue
    fi
    blockers="$(gh api "repos/$R/issues/$n/dependencies/blocked_by" \
      --jq '[.[] | select(.state == "open")] | length' 2>/dev/null || echo 0)"
    if [ "${blockers:-0}" -eq 0 ]; then
      frontier=$(( frontier + 1 ))
    else
      echo "Issue #$n is behind $blockers open dependency/dependencies; not frontier" >> "$summary"
    fi
  done
  if [ "$frontier" -gt 0 ]; then
    unless_red "the slot is free and $frontier unblocked queued issue(s) wait"
    decide false "the slot is free and $frontier queued issue(s) wait, but main is red ($red)"
  fi
  decide false "the slot is free but the queue is empty"
fi

decide false "the slot is held and no open agent PR needs the routine${red:+ while main is red ($red)}"
