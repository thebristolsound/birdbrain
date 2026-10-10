#!/usr/bin/env bash
# Post the review the session left in .dispatch/verdict.md, as the machine account,
# and set the PR's state label (ADR-0046). Runs on every exit of a review the
# pre-gate started, so a run that ends without a usable verdict still leaves the PR
# labelled `review:failed` instead of looking like it is waiting.
#
# A verdict is usable when its first line is a verdict line, its Full report block
# opens with the reviewed commit the pre-gate picked, and the comment linter passes.
#
# Env: GH_TOKEN (machine token), PR, SHA, RUN_OUTCOME (the review step's outcome).
set -euo pipefail

here="$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=.github/scripts/dispatch/lib.sh
. "$here/../dispatch/lib.sh"
# shellcheck source=.github/scripts/pr-review/lib.sh
. "$here/lib.sh"

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
: "${PR:?}" "${SHA:?}"
file=.dispatch/verdict.md
lint="$here/../../../.claude/skills/post-comment/scripts/check.sh"

note() { echo "Post: $*" | tee -a "$summary"; }

labels="$(gh api "repos/$R/issues/$PR/labels?per_page=100" --jq '[.[].name]')"

why=""
if [ "${RUN_OUTCOME:-}" != success ]; then
  why="the review step ended ${RUN_OUTCOME:-unknown}"
elif [ ! -s "$file" ]; then
  why="the session left no verdict"
else
  case "$(head -n 1 "$file")" in
    '**Review verdict: approve for human review**') want="$REVIEW_PASSED" ;;
    '**Review verdict: request changes**') want="$REVIEW_CHANGES" ;;
    *) why="the verdict's first line is not a verdict line" ;;
  esac
  if [ -z "$why" ] && ! grep -qxF "$REVIEWED_COMMIT_PREFIX$SHA" "$file"; then
    why="the verdict does not name the reviewed commit $SHA"
  fi
  if [ -z "$why" ] && ! bash "$lint" "$file"; then
    why="the verdict failed the comment linter"
  fi
fi

if [ -n "$why" ]; then
  set_review_label "$R" "$PR" "$REVIEW_FAILED" "$labels"
  note "#$PR labelled $REVIEW_FAILED: $why"
  exit 0
fi

jq -n --rawfile body "$file" '{body: $body}' > .dispatch/verdict.json
gh api -X POST "repos/$R/issues/$PR/comments" --input .dispatch/verdict.json >/dev/null
note "#$PR: posted the verdict on ${SHA:0:8}"

head="$(gh api "repos/$R/pulls/$PR" --jq .head.sha)"
if [ "$head" != "$SHA" ]; then
  want="$REVIEW_STALE"
  note "#$PR: the head moved to ${head:0:8} during the review"
fi
set_review_label "$R" "$PR" "$want" "$labels"
note "#$PR labelled $want"
