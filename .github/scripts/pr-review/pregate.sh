#!/usr/bin/env bash
# Pick the one PR this fire of the scheduled PR review reviews, from the API alone
# (ADR-0046), and keep every open PR's state label true on the way.
#
# A PR is a candidate when the maintainer opened it from this repository, dispatch
# does not own it (no `agent-pr`), and it does not carry `review:skipped`. A
# candidate is owed a review when:
#   - it opened at least MIN_AGE ago, so the review bots get the first look;
#   - nobody but the maintainer and the pipeline has reviewed it since the
#     pipeline's last verdict on it (or ever, when there is none);
#   - its diff touches more than process docs (.claude/, docs/, root Markdown),
#     which the dispatch skill also leaves to the maintainer. Such a PR gets
#     `review:skipped` here, and loses it again if a later push adds code;
#   - it has no state label (a first review), carries `review:failed` the
#     pipeline applied only once (one retry), or carries `review:stale`.
# First reviews go before retries, retries before stale ones, oldest first in each.
#
# Free writes, before any decision: a `review:passed` or `review:changes` whose
# verdict names a commit other than the head becomes `review:stale`. Report mode
# makes no write and names each one it would have made.
#
# The spend cap counts this workflow's own runs (cap.sh): CAP_TOTAL reviews in 24
# hours, and CAP_PER_TARGET per PR in 6 hours. Dispatch counts its runs separately.
#
# $1 = mode: review | report. Report mode decides, writes nothing, and never runs.
# Env: GH_TOKEN (machine token), LOGIN (machine login), TARGET_PR (optional: consider
# only this PR; every check above still applies).
# Output: run=true|false, reason, pr, sha.
set -euo pipefail

here="$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=.github/scripts/dispatch/lib.sh
. "$here/../dispatch/lib.sh"
# shellcheck source=.github/scripts/dispatch/cap.sh
. "$here/../dispatch/cap.sh"
# shellcheck source=.github/scripts/pr-review/lib.sh
. "$here/lib.sh"

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
mode="${1:-review}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
me="${LOGIN:?LOGIN is the machine login; the verdicts and labels this step reads are its}"
target="${TARGET_PR:-}"
MIN_AGE='60 minutes ago'
oldest_allowed="$(date -u -d "$MIN_AGE" +%FT%TZ)"

# The maintainer's authorization of 2026-10-09 (ADR-0046).
CAP_TOTAL=4
CAP_TOTAL_WINDOW='24 hours ago'
CAP_PER_TARGET=1
CAP_PER_TARGET_WINDOW='6 hours ago'
CAP_WORKFLOW='pr-review.yml'
CAP_PAID_STEP='Claude credential'
CAP_TARGET_TITLE='Review target'
cap_total_since="$(date -u -d "$CAP_TOTAL_WINDOW" +%FT%TZ)"
cap_target_since="$(date -u -d "$CAP_PER_TARGET_WINDOW" +%FT%TZ)"
cap_rerun_since="$(date -u -d '30 days ago' +%FT%TZ)"

say() { echo "$*" >> "$summary"; }

decide() {
  {
    echo "run=$1"
    echo "reason=$2"
    echo "pr=${3:-}"
    echo "sha=${4:-}"
  } >> "$out"
  echo "Pre-gate: run=$1 ($2)" | tee -a "$summary"
  exit 0
}

# Make $2 PR $1's only state label, and update the loop's `labels` to match. Report mode
# only says so.
relabel() {
  if [ "$mode" = report ]; then
    say "Would label #$1 $2"
  else
    set_review_label "$R" "$1" "$2" "$labels"
    say "Labelled #$1 $2"
  fi
  labels="$(jq -c --argjson s "$states" --arg l "$2" \
    '[.[] | select(. as $x | $s | index($x) | not)] + [$l]' <<<"$labels")"
}

# Take state label $2 off PR $1 without putting another on.
unlabel() {
  if [ "$mode" = report ]; then
    say "Would remove $2 from #$1"
  else
    gh api -X DELETE "repos/$R/issues/$1/labels/${2//:/%3A}" >/dev/null
    say "Removed $2 from #$1"
  fi
  labels="$(jq -c --arg l "$2" 'map(select(. != $l))' <<<"$labels")"
}

# "true" when every path PR $1 changes is a process doc, else "false". Called as an
# assignment, so a failed read ends the step instead of reading as "false".
process_only() {
  list "repos/$R/pulls/$1/files?per_page=100" \
    | jq 'length > 0 and all(.[].filename; test("^(\\.claude/|docs/)|^[^/]+\\.md$"))'
}

# How many times the pipeline applied label $2 to PR $1, and who applied it last.
label_history() {
  list "repos/$R/issues/$1/events?per_page=100" | jq -r --arg l "$2" --arg me "$me" '
    [.[] | select(.event == "labeled" and .label.name == $l)]
    | "\(map(select(.actor.login == $me)) | length)\t\(last.actor.login // "")"'
}

states="$(printf '%s\n' "${REVIEW_STATES[@]}" | jq -R . | jq -s -c .)"
pulls="$(list "repos/$R/pulls?state=open&per_page=100")"
mine="$(jq -c --arg owner "$MAINTAINER" --arg repo "$R" --arg t "$target" '
  [.[] | select(.user.login == $owner and (.head.repo.full_name // "") == $repo)
    | select($t == "" or (.number | tostring) == $t)
    | {n: .number, sha: .head.sha, created: .created_at, labels: [.labels[].name]}
    | select(.labels | index("agent-pr") | not)]
  | sort_by(.created)' <<<"$pulls")"

if [ "$(jq length <<<"$mine")" -eq 0 ]; then
  if [ -n "$target" ]; then
    decide false "PR #$target is not an open PR the maintainer opened outside the dispatch slots"
  fi
  decide false "no open PR the maintainer opened outside the dispatch slots"
fi

first=()
retry=()
stale=()
while IFS=$'\t' read -r n sha created labels; do
  state="$(jq -r --argjson s "$states" '[.[] | select(. as $l | $s | index($l))] | first // ""' \
    <<<"$labels")"

  if [ "$state" = "$REVIEW_SKIPPED" ]; then
    history="$(label_history "$n" "$REVIEW_SKIPPED")"
    po=true
    if [ "${history#*$'\t'}" = "$me" ]; then po="$(process_only "$n")"; fi
    if [ "$po" = false ]; then
      unlabel "$n" "$REVIEW_SKIPPED"
      state=""
    else
      say "#$n: skipped (labelled $REVIEW_SKIPPED)"
      continue
    fi
  fi

  verdict="$(last_verdict "$R" "$n" "$me")"
  reviewed="$(jq -r '.sha // ""' <<<"$verdict")"
  verdict_at="$(jq -r '.at // ""' <<<"$verdict")"

  if [ "$state" = "$REVIEW_PASSED" ] || [ "$state" = "$REVIEW_CHANGES" ]; then
    if [ "$reviewed" = "$sha" ]; then
      say "#$n: reviewed at head (${state})"
      continue
    fi
    relabel "$n" "$REVIEW_STALE"
    state="$REVIEW_STALE"
  fi

  if [[ "$created" > "$oldest_allowed" ]]; then
    say "#$n: opened at $created, under ${MIN_AGE% ago} ago"
    continue
  fi

  others="$(list "repos/$R/pulls/$n/reviews?per_page=100" \
    | jq -r --arg owner "$MAINTAINER" --arg me "$me" --arg since "$verdict_at" '
      [.[] | select(.user.login != $owner and .user.login != $me)
        | select((.submitted_at // "") > $since) | .user.login] | unique | join(", ")')"
  if [ -n "$others" ]; then
    say "#$n: reviewed by $others${verdict_at:+ since the last verdict}"
    continue
  fi

  po="$(process_only "$n")"
  if [ "$po" = true ]; then
    relabel "$n" "$REVIEW_SKIPPED"
    continue
  fi

  case "$state" in
    "") first+=("$n:$sha") ;;
    "$REVIEW_FAILED")
      history="$(label_history "$n" "$REVIEW_FAILED")"
      failures="${history%%$'\t'*}"
      if [ "$failures" -le 1 ]; then
        retry+=("$n:$sha")
      else
        say "#$n: failed $failures times; remove $REVIEW_FAILED to try again"
      fi
      ;;
    "$REVIEW_STALE") stale+=("$n:$sha") ;;
  esac
done < <(jq -r '.[] | [.n, .sha, .created, (.labels | tojson)] | @tsv' <<<"$mine")

queue=("${first[@]}" "${retry[@]}" "${stale[@]}")
[ "${#queue[@]}" -gt 0 ] || decide false "no PR is owed a review"

cap_paid="$(paid_cycles)" \
  || decide false "could not count the reviews already started, so the spend cap holds this one"
used="$(jq length <<<"$cap_paid")"
[ "$used" -lt "$CAP_TOTAL" ] \
  || decide false "the spend cap holds this review: $used started since $cap_total_since, and the limit is $CAP_TOTAL in ${CAP_TOTAL_WINDOW% ago}"

for entry in "${queue[@]}"; do
  n="${entry%%:*}"
  sha="${entry#*:}"
  last="$(jq -r --argjson n "$n" --arg since "$cap_target_since" --argjson max "$CAP_PER_TARGET" '
    [.[] | select(.at >= $since and (.targets == null or (.targets | index($n) != null)))]
    | if length >= $max then map(.at) | max else empty end' <<<"$cap_paid")"
  if [ -n "$last" ]; then
    say "#$n: held by the spend cap, reviewed at $last and the limit is $CAP_PER_TARGET in ${CAP_PER_TARGET_WINDOW% ago}"
    continue
  fi
  if [ "$mode" = report ]; then
    decide false "report mode: would review #$n at ${sha:0:8}" "$n" "$sha"
  fi
  echo "::notice title=$CAP_TARGET_TITLE::$n"
  decide true "#$n at ${sha:0:8} is owed a review" "$n" "$sha"
done
decide false "the spend cap holds every PR owed a review"
