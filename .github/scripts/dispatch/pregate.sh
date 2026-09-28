#!/usr/bin/env bash
# Decide from the API alone whether this fire has anything to do.
#
# The full cycle costs a toolchain install and a Claude session. Most hours it
# would find the slot occupied with nothing owed and exit, so this step asks
# the cheap version of the skill's sections 1 to 3 first and skips the rest when
# every answer is "nothing". It is deliberately conservative:
# any doubt reads as "run", because a missed cycle costs an hour and a spurious
# one costs minutes. Who acted is the exception (#1310): nobody but the
# maintainer starts or feeds a paid run. A comment or review from outside the
# trust list below, and a head anyone but the maintainer or the pipeline pushed,
# start nothing. Every label this step reads is read in its trusted state (see
# label_trust), and its only writes put a label back to that state, so no label
# change from outside the trust list costs a cycle. The one commit status it reads
# on a PR counts only from the maintainer or the pipeline (trusted_prepass). Each
# is named in the step summary.
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
# pipeline's own, so neither its comments nor the review bots' start a cycle,
# and the step writes no label.
me="${LOGIN:-}"
# The trust list, from the spend ruling on #1310: the maintainer, the pipeline
# itself, and the named review bots on a PR the pipeline opened. Everyone else,
# other collaborators included, is untrusted. "Session rules" in
# .claude/skills/dispatch/SKILL.md holds the same list, and claude.yml's
# include_comments_by_actor a third copy under GraphQL names; change all three.
# REST names the Copilot reviewer's inline comments `Copilot` and its reviews
# `copilot-pull-request-reviewer[bot]`. The maintainer's login is in lib.sh.
maintainer="$MAINTAINER"
review_bots='["coderabbitai[bot]","chatgpt-codex-connector[bot]","Copilot","copilot-pull-request-reviewer[bot]"]'
# Every label this step reads, and whose adding (labeled) and removing
# (unlabeled) count: m is the maintainer, p the pipeline. A label's trusted state
# is the one the newest counted event set, and an item with no counted event
# does not carry it. This step puts a label back on when its trusted state is
# on, and takes it off when that state is off and strip is set. Two are never
# taken off: evidence-affecting, which no automation removes, and
# ready-for-agent, which would leave the issue with no triage label.
# "Session rules" in the skill holds the same table; change both.
label_trust="$(jq -n -c --arg park "$AWAITING_MAINTAINER_LABEL" '{
  "agent-pr": {labeled: "mp", unlabeled: "mp", strip: true},
  "agent-wip": {labeled: "mp", unlabeled: "mp", strip: true},
  ($park): {labeled: "mp", unlabeled: "m", strip: true},
  "evidence-affecting": {labeled: "mp", unlabeled: "mp", strip: false},
  "ready-for-agent": {labeled: "m", unlabeled: "mp", strip: false},
  "queued": {labeled: "m", unlabeled: "m", strip: true},
  "process": {labeled: "mp", unlabeled: "mp", strip: true}
}')"
# Shared by the jq programs that read label events; the $ names are jq's.
# shellcheck disable=SC2016
jq_counted='def role: if . == $owner then "m" elif ($me != "" and . == $me) then "p" else "" end;
  def counted: ((.actor.login // "") | role) as $r
    | $r != "" and ($trust[.label.name][.event] | contains($r));'
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

# Whether login $1 is the maintainer or, inside the workflow, the pipeline.
trusted_actor() { [ "$1" = "$maintainer" ] || { [ -n "$me" ] && [ "$1" = "$me" ]; }; }

# The newest agent/pre-pass status on commit $1 that the maintainer or the
# pipeline posted, as {state, desc, at, ignored}, from trusted_statuses in lib.sh.
# pre-pass-gate.yml's seed is posted by github-actions[bot], so it never counts;
# it only ever meant "no verdict yet", which "absent" means too.
trusted_prepass() {
  trusted_statuses "$R" "$1" "$me" \
    | jq -c '.["agent/pre-pass"] // {state: "absent", desc: "", at: "", ignored: []}'
}

# The trusted state of every label in label_trust on issue or PR $1, from its
# events, as {"<label>": {on, since, set, last}}. set is the counted event that
# made the state, since when the unbroken run of "on" began (so putting a label
# back does not refresh a claim's age), and last the newest event from anyone.
# The events API names who applied or removed a label; the labels on the issue
# do not.
trusted_labels() {
  gh api --paginate "repos/$R/issues/$1/events?per_page=100" \
    | jq -s -c --arg owner "$maintainer" --arg me "$me" --argjson trust "$label_trust" "$jq_counted"'
      [add // [] | .[] | select(.event == "labeled" or .event == "unlabeled")
        | select($trust[.label.name] != null)
        | {label: .label.name, event, at: .created_at, by: (.actor.login // ""), counted: counted}]
      | sort_by(.at) as $ev
      | $trust | with_entries(.key as $l | .value = (
          [$ev[] | select(.label == $l)] as $all
          | [$all[] | select(.counted)] as $t
          | ($t | last) as $set
          | (([$t[] | select(.event == "unlabeled") | .at] | last) // "") as $off
          | {on: ($set.event == "labeled"),
             since: (if $set.event == "labeled"
                     then ([$t[] | select(.event == "labeled" and .at > $off) | .at] | first)
                     else "" end),
             set: $set,
             last: ($all | last)}))'
}

# Issues with a label event in the last four hours that the table does not
# count. One whose agent-wip, ready-for-agent or queued someone else removed is
# missing from the label lists below, and a claim older than four hours is aged
# out anyway. The endpoint lists newest first.
recent_changes() {
  local page=1 events
  while :; do
    events="$(gh api "repos/$R/issues/events?per_page=100&page=$page")"
    jq -r --arg after "$stale_before" --arg owner "$maintainer" --arg me "$me" \
      --argjson trust "$label_trust" "$jq_counted"'
      .[] | select(.created_at >= $after and (.issue.pull_request | not))
      | select(.event == "labeled" or .event == "unlabeled")
      | select($trust[.label.name] != null)
      | select(counted | not) | .issue.number' <<<"$events"
    [ "$(jq length <<<"$events")" -eq 100 ] || break
    jq -e --arg after "$stale_before" 'any(.[]; .created_at >= $after)' <<<"$events" >/dev/null \
      || break
    page=$(( page + 1 ))
  done | sort -un
}

# Put label $3 on $1 #$2 back to its trusted state $4 (one entry of
# trusted_labels) when $5, the item's label names, disagrees with it. A write
# that fails is recorded in restore_failed, which stops this fire before any
# decision: a cycle would read the label as it stands.
restore_failed=""
reconcile() {
  local noun="$1" n="$2" label="$3" st="$4" names="$5" on physical change strip
  on="$(jq -r .on <<<"$st")"
  physical="$(jq -r --arg l "$label" 'index($l) != null' <<<"$names")"
  [ "$on" = "$physical" ] && return 0
  change="$(jq -r --arg l "$label" 'if .last == null or .last.counted
    then "\($l) went \(if .on then "off" else "on" end) with no event naming who changed it"
    else "\(if .last.by == "" then "an unrecorded account" else .last.by end) \(if .last.event == "labeled" then "added" else "removed" end) \($l) at \(.last.at)" end' <<<"$st")"
  strip="$(jq -r --arg l "$label" '.[$l].strip' <<<"$label_trust")"
  if [ "$on" = false ] && [ "$strip" = false ]; then
    echo "$noun #$n: $change, which does not count; left on" >> "$summary"
    return 0
  fi
  if [ -z "$me" ]; then
    echo "$noun #$n: $change, which does not count; not written, because LOGIN is unset" >> "$summary"
    return 0
  fi
  if [ "$on" = true ]; then
    if gh api -X POST "repos/$R/issues/$n/labels" -f "labels[]=$label" --jq '[.[].name]' \
        | jq -e --arg l "$label" 'index($l)' >/dev/null; then
      echo "$noun #$n: $change, which does not count; applied it again" >> "$summary"
      return 0
    fi
  elif gh api -X DELETE "repos/$R/issues/$n/labels/$label" >/dev/null; then
    echo "$noun #$n: $change, which does not count; removed it" >> "$summary"
    return 0
  fi
  echo "$noun #$n: $change, which does not count, and putting it back failed" | tee -a "$summary"
  restore_failed="${restore_failed:+$restore_failed, }$label on #$n"
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
# out the pipeline's own activity, "maintainer" keeps only his, "pipeline" only its.
newest_trusted() {
  jq -r --arg owner "$maintainer" --arg me "$me" --arg scope "$2" \
    '.[] | select(.trusted)
      | select(if $scope == "maintainer" then .login == $owner
               elif $scope == "pipeline" then ($me != "" and .login == $me)
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

# Every open PR is read, because one whose agent-pr someone else removed still
# holds the slot. A PR is an agent PR when agent-pr is on in its trusted state.
declare -A states=()
pulls="$(list "repos/$R/pulls?state=open&per_page=100")"
prs='[]'
for n in $(jq -r '.[].number' <<<"$pulls"); do
  states[$n]="$(trusted_labels "$n")"
  names="$(jq -c --argjson n "$n" '.[] | select(.number == $n) | [.labels[].name]' <<<"$pulls")"
  reconcile PR "$n" agent-pr "$(jq -c '.["agent-pr"]' <<<"${states[$n]}")" "$names"
  jq -e '.["agent-pr"].on' <<<"${states[$n]}" >/dev/null || continue
  prs="$(jq -c --argjson n "$n" '. + [$n]' <<<"$prs")"
  for l in "$AWAITING_MAINTAINER_LABEL" evidence-affecting; do
    reconcile PR "$n" "$l" "$(jq -c --arg l "$l" '.[$l]' <<<"${states[$n]}")" "$names"
  done
done

# Open issues that carry a claim or both queue labels, or had a label change
# that does not count in the last four hours.
issues="$( {
  list "repos/$R/issues?state=open&labels=agent-wip&per_page=100"
  list "repos/$R/issues?state=open&labels=ready-for-agent,queued&per_page=100"
  for n in $(recent_changes); do gh api "repos/$R/issues/$n" | jq -c '[.]'; done
} | jq -s -c 'add | map(select((.pull_request | not) and .state != "closed")) | unique_by(.number)')"
wip='[]'
for n in $(jq -r '.[].number' <<<"$issues"); do
  states[$n]="$(trusted_labels "$n")"
  names="$(jq -c --argjson n "$n" '.[] | select(.number == $n) | [.labels[].name]' <<<"$issues")"
  for l in agent-wip ready-for-agent queued process; do
    reconcile Issue "$n" "$l" "$(jq -c --arg l "$l" '.[$l]' <<<"${states[$n]}")" "$names"
  done
  if jq -e '.["agent-wip"].on' <<<"${states[$n]}" >/dev/null; then
    wip="$(jq -c --argjson n "$n" '. + [$n]' <<<"$wip")"
  fi
done

if [ -n "$restore_failed" ]; then
  decide false "could not put back $restore_failed to its trusted state; the next fire tries again"
fi

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
# The claim's age runs from the counted add that put agent-wip on.
for n in $(jq -r '.[]' <<<"$wip"); do
  claimed="$(jq -r '.["agent-wip"].since // ""' <<<"${states[$n]}")"
  if [ -z "$claimed" ] || [[ ! "$claimed" > "$stale_before" ]]; then
    decide true "issue #$n holds an agent-wip claim from ${claimed:-an unrecorded time}, past the 4-hour expiry; section 1 must age it out"
  fi
done

# Section 2: does any open agent PR need the routine?
for n in $(jq -r '.[]' <<<"$prs"); do
  st="${states[$n]}"
  # Parking, per the maintainer's ruling of 2026-09-28 on #1310: while the label
  # is on, nothing wakes the PR, whether a comment, a review or a push, his
  # included, or a verdict owed on its head. Only his removal of the label wakes
  # it; anyone else's does not count, and reconcile has put the label back.
  if jq -e --arg l "$AWAITING_MAINTAINER_LABEL" '.[$l].on' <<<"$st" >/dev/null; then
    echo "PR #$n is parked for the maintainer; skipped until he removes $AWAITING_MAINTAINER_LABEL" >> "$summary"
    continue
  fi
  # Empty unless the maintainer's removal set the label's trusted state.
  woken_at="$(jq -r --arg l "$AWAITING_MAINTAINER_LABEL" \
    'if .[$l].set.event == "unlabeled" then .[$l].set.at else "" end' <<<"$st")"
  pr="$(jq -c --argjson n "$n" '.[] | select(.number == $n)' <<<"$pulls")"
  sha="$(jq -r .head.sha <<<"$pr")"
  draft="$(jq -r .draft <<<"$pr")"
  author="$(jq -r '.user.login // empty' <<<"$pr")"
  pushed_at=""
  untrusted_head=""
  prepass="$(trusted_prepass "$sha")"
  state="$(jq -r .state <<<"$prepass")"
  desc="$(jq -r .desc <<<"$prepass")"
  jq -r --arg pr "$n" --arg sha "${sha:0:8}" '.ignored | select(length > 0)
    | map("\(.state) by \(if .by == "" then "an unrecorded account" else .by end) at \(.at)")
    | "PR #\($pr) head \($sha) has agent/pre-pass statuses from outside the trust list, not counted: \(join(", "))"' \
    <<<"$prepass" >> "$summary"
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
  items="$(activity "$n" "$author")"
  head_at="$(gh api "repos/$R/commits/$sha" --jq .commit.committer.date)"
  report_untrusted "$n" "$items" "$head_at"
  # Woken by the maintainer: one cycle is owed, and the pipeline's first comment
  # on the PR after his removal (a verdict, or the reason it parked the PR again)
  # marks that cycle done. From then on its comments are never activity; they
  # only move the point that newer activity must pass, so feedback the woken
  # cycle already answered without a push does not start another.
  answered=""
  if [ -n "$woken_at" ]; then
    answered="$(newest_trusted "$items" pipeline)"
    if [ -z "$answered" ] || [[ ! "$answered" > "$woken_at" ]]; then
      decide true "PR #$n was woken when the maintainer removed $AWAITING_MAINTAINER_LABEL at $woken_at, and the pipeline has not answered on it since; one cycle is owed"
    fi
  fi
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
  after="$head_at"
  than="its head ($head_at)"
  if [ -n "$woken_at" ]; then
    newest="$(newest_trusted "$items" others)"
    if [[ "$answered" > "$head_at" ]]; then
      after="$answered"
      than="the pipeline's last comment ($answered)"
    fi
  elif [ "$state" = success ]; then
    newest="$(newest_trusted "$items" others)"
  else
    newest="$(newest_trusted "$items" all)"
  fi
  if [ -n "$newest" ] && [[ "$newest" > "$after" ]]; then
    decide true "PR #$n has activity at $newest newer than $than"
  fi
  # Section 2a never merges a PR whose trusted state is evidence-affecting.
  # One that carries the label only from outside the trust list is not merged
  # either, since merge.sh refuses any PR carrying it, so a cycle would change
  # nothing; this step leaves that label on.
  if [ "$state" = success ] && [ "$draft" = false ]; then
    if jq -e '.["evidence-affecting"].on' <<<"$st" >/dev/null; then
      echo "PR #$n is evidence-affecting; section 2a never merges it" >> "$summary"
    elif jq -e '[.labels[].name] | index("evidence-affecting")' <<<"$pr" >/dev/null; then
      echo "PR #$n carries evidence-affecting from outside the trust list; section 2a does not merge it" >> "$summary"
    else
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
  for n in $(jq -r '.[] | select(.assignees | length == 0) | .number' <<<"$issues"); do
    # Only the maintainer queues work: both queue labels on and process off, each
    # in its trusted state.
    jq -e '.["ready-for-agent"].on and .queued.on and (.process.on | not)' <<<"${states[$n]}" \
      >/dev/null || continue
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
