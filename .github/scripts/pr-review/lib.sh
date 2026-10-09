#!/usr/bin/env bash
# Strings and writes the scheduled PR review's pre-gate and post step must agree on
# (ADR-0046). Source .github/scripts/dispatch/lib.sh first, for MAINTAINER and list().

# The state labels. A PR carries at most one; none means it is still waiting.
REVIEW_PASSED='review:passed'
REVIEW_CHANGES='review:changes'
REVIEW_STALE='review:stale'
REVIEW_FAILED='review:failed'
REVIEW_SKIPPED='review:skipped'
REVIEW_STATES=("$REVIEW_PASSED" "$REVIEW_CHANGES" "$REVIEW_STALE" "$REVIEW_FAILED" "$REVIEW_SKIPPED")

# The first line inside a verdict's Full report block. The post step refuses a verdict
# without it, and the pre-gate reads the reviewed commit back from it.
REVIEWED_COMMIT_PREFIX='Reviewed commit: '

# The newest verdict the pipeline (login $3) posted on PR $2 of repository $1, as
# {at, sha}, or {} when it has posted none.
last_verdict() {
  list "repos/$1/issues/$2/comments?per_page=100" | jq -c --arg me "$3" --arg p "$REVIEWED_COMMIT_PREFIX" '
    [.[] | select(.user.login == $me and (.body | startswith("**Review verdict: ")))
      | {at: .created_at, sha: ((.body | capture($p + "(?<s>[0-9a-f]{40})") // {}).s // "")}]
    | last // {}'
}

# Leave $3 as the only state label on PR $2 of repository $1. $4 is the PR's current
# label names as a JSON array, so labels already right cost no write.
set_review_label() {
  local repo="$1" n="$2" want="$3" have="$4" l
  for l in "${REVIEW_STATES[@]}"; do
    [ "$l" = "$want" ] && continue
    if jq -e --arg l "$l" 'index($l)' <<<"$have" >/dev/null; then
      gh api -X DELETE "repos/$repo/issues/$n/labels/${l//:/%3A}" >/dev/null
    fi
  done
  if ! jq -e --arg l "$want" 'index($l)' <<<"$have" >/dev/null; then
    gh api -X POST "repos/$repo/issues/$n/labels" -f "labels[]=$want" >/dev/null
  fi
}
