#!/usr/bin/env bash
# Posts the agent/pre-pass commit status on a PR's current head as the machine account.
#   post-status.sh <pr-number> <pending|success|failure> <description> [<target-url>]
# It resolves the full head sha itself: the statuses endpoint rejects a short one (422), and
# the description cap is GitHub's 140 characters.
set -u
n="${1:-}" state="${2:-}" desc="${3:-}" url="${4:-}"
[ -n "$n" ] && [ -n "$state" ] && [ -n "$desc" ] || {
  echo "usage: post-status.sh <pr-number> <pending|success|failure> <description> [<target-url>]" >&2; exit 2; }
case "$state" in pending|success|failure) ;; *) echo "post-status: state must be pending, success or failure" >&2; exit 2 ;; esac
[ "${#desc}" -le 140 ] || { echo "post-status: the description is ${#desc} characters; the cap is 140" >&2; exit 2; }
[ -n "${BIRDBRAIN_AGENT_GH_TOKEN:-}" ] || { echo "post-status: BIRDBRAIN_AGENT_GH_TOKEN is not set; see docs/agents/github-access.md" >&2; exit 2; }
agh() { GH_TOKEN="$BIRDBRAIN_AGENT_GH_TOKEN" gh "$@"; }

sha="$(agh api "repos/{owner}/{repo}/pulls/$n" --jq .head.sha)" || { echo "post-status: cannot read PR #$n" >&2; exit 1; }
# shellcheck disable=SC2086
agh api "repos/{owner}/{repo}/statuses/$sha" -f state="$state" -f context=agent/pre-pass -f description="$desc" ${url:+-f target_url="$url"} \
  --jq '"\(.context) \(.state) on '"${sha:0:12}"'"' || { echo "post-status: the status post failed" >&2; exit 1; }
