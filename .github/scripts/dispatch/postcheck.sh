#!/usr/bin/env bash
# Mechanical postconditions on a completed cycle (#1063).
#
# The routine reads the implementer's final text and acts on it. Nothing in the
# skill checks that a dispatched branch carries commits, so an agent that ends
# cleanly having produced nothing passes as success. This step reads GitHub, not
# the report: every PR the machine account opened during this run must be at
# least one commit ahead of main and carry agent-authored, and no dispatch claim
# taken during this run may still be live without a PR.
#
# Env: GH_TOKEN (machine token), STARTED (run start, UTC), LOGIN (machine login).
set -euo pipefail

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
: "${STARTED:?}" "${LOGIN:?}"
failed=0

git fetch --quiet origin main

# PRs this run opened.
opened="$(gh api "repos/$R/pulls?state=open&sort=created&direction=desc&per_page=30" \
  | jq --arg login "$LOGIN" --arg since "$STARTED" \
  '[.[] | select(.user.login == $login and .created_at >= $since) | {number, ref: .head.ref}]')"

for row in $(jq -c '.[]' <<<"$opened"); do
  n="$(jq -r .number <<<"$row")"
  ref="$(jq -r .ref <<<"$row")"
  git fetch --quiet origin "$ref"
  ahead="$(git rev-list --count "origin/main..origin/$ref")"
  labels="$(gh api "repos/$R/issues/$n/labels" --jq '[.[].name]')"
  if [ "$ahead" -lt 1 ]; then
    echo "PR #$n ($ref) has no commits ahead of main" | tee -a "$summary"; failed=1
  fi
  if ! jq -e 'index("agent-authored")' <<<"$labels" >/dev/null; then
    echo "PR #$n ($ref) is missing the agent-authored label" | tee -a "$summary"; failed=1
  fi
  echo "PR #$n ($ref): $ahead commit(s) ahead of main, labels $labels" >> "$summary"
done
[ "$(jq length <<<"$opened")" -eq 0 ] && echo "No PR was opened during this run." >> "$summary"

# Claims taken during this run that neither converted to a PR nor were released.
for n in $(gh api --paginate "repos/$R/issues?state=open&labels=agent-wip&per_page=100" \
    | jq -s -r 'add // [] | .[] | select(.pull_request | not) | .number'); do
  labelled_at="$(gh api --paginate "repos/$R/issues/$n/events?per_page=100" \
    | jq -s -r 'add // [] | [.[] | select(.event == "labeled" and .label.name == "agent-wip") | .created_at] | max // empty')"
  if [ -n "$labelled_at" ] && [[ "$labelled_at" > "$STARTED" ]]; then
    echo "Issue #$n was claimed at $labelled_at during this run and still holds agent-wip with no PR" \
      | tee -a "$summary"
    failed=1
  fi
done

exit "$failed"
