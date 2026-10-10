#!/usr/bin/env bash
# Turn .health/findings.md into exactly one open alert issue, or close it.
#
# One issue, labelled `health-alert`, is the alarm: opened and assigned to the
# repository owner the first day there are findings, its body rewritten and a
# comment added on any day the findings change, closed with a comment on the
# first clean day. A day with unchanged findings only refreshes the body, so a
# standing condition is one notification, not one a day. `process` keeps it out
# of the dispatch frontier (ADR-0028: never queue, never dispatch), and the
# stale sweep only closes issues the machine account filed, which this is not.
#
# The label lookup goes through the list endpoint's `labels=` filter, which
# CLAUDE.md notes lags a direct read by seconds. At a twice-daily cadence that lag
# cannot matter.
#
# Env in: GH_TOKEN (github.token, issues: write), GITHUB_REPOSITORY,
#         GITHUB_REPOSITORY_OWNER (assignee), RUN_URL, FINDINGS (true|false).
set -euo pipefail

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
owner="${GITHUB_REPOSITORY_OWNER:?}"
run_url="${RUN_URL:-<unknown>}"
findings=.health/findings.md
label=health-alert
now="$(date -u +%FT%TZ)"

gh label create "$label" --color B60205 --force \
  --description 'Opened by the health workflow while a scheduled job or credential is broken' >/dev/null

open="$(gh api "repos/$R/issues?state=open&labels=$label&per_page=5" \
  --jq '[.[] | select(.pull_request | not)] | first | .number // empty')"

if [ "${FINDINGS:-false}" != "true" ]; then
  if [ -n "$open" ]; then
    printf 'Recovered: the health check at %s found nothing wrong. Closing.\n\nRun: %s\n' "$now" "$run_url" > .health/comment.md
    gh issue comment "$open" --body-file .health/comment.md >/dev/null
    gh issue close "$open" --reason completed >/dev/null
    echo "Closed #$open: recovered." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  else
    echo 'No findings and no open alert.' | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  fi
  exit 0
fi

count="$(wc -l < "$findings")"
{
  printf 'The scheduled automation has %s problem(s) that will not fix themselves. Each line below says what is broken and what to do about it. This issue is rewritten by every health run (06:20 and 18:20 UTC) and closes itself once the check comes back clean.\n\n' "$count"
  printf 'Last checked: %s\n\n' "$now"
  printf '<details>\n<summary>Findings</summary>\n\n'
  cat "$findings"
  printf '\nRun: %s\n' "$run_url"
  printf '\nHow to rotate: `docs/agents/github-access.md` (GitHub token), `claude setup-token` then `gh secret set CLAUDE_CODE_OAUTH_TOKEN --body "$(cat file)"` (Claude token).\n'
  printf '</details>\n'
} > .health/body.md
title="Scheduled automation health: $count finding(s)"

if [ -z "$open" ]; then
  new="$(gh issue create --title "$title" --body-file .health/body.md \
    --label "$label" --label process --assignee "$owner")"
  echo "Opened $new" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi

# Compare the findings, not the body: the body carries the timestamp.
prev="$(gh issue view "$open" --json body --jq .body | sed -n '/<summary>Findings<\/summary>/,/^Run: /p' | grep '^- ' || true)"
gh issue edit "$open" --title "$title" --body-file .health/body.md >/dev/null
if [ "$prev" != "$(grep '^- ' "$findings")" ]; then
  { printf 'Findings changed at %s:\n\n' "$now"; cat "$findings"; printf '\nRun: %s\n' "$run_url"; } > .health/comment.md
  gh issue comment "$open" --body-file .health/comment.md >/dev/null
  echo "Updated #$open: findings changed, commented." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  echo "Updated #$open: findings unchanged." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
fi
