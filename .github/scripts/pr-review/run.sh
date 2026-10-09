#!/usr/bin/env bash
# Review one PR through headless Claude Code (ADR-0046): the pr-review skill spawns
# the reviewer and leaves its verdict in .dispatch/verdict.md for post.sh to post.
#
# Env: PR, SHA (from the pre-gate), CLAUDE_CODE_OAUTH_TOKEN, DISPATCH_MODEL,
# DISPATCH_EFFORT, RUN_URL, and GH_TOKEN, which pr-review.yml sets to the job's
# read-only GITHUB_TOKEN for this step: the session can read the PR and cannot write
# to GitHub at all. The post step writes, as the machine account.
#
# The artifact directory is .dispatch/, so dispatch's scrub.sh covers it unchanged.
set -euo pipefail

# shellcheck source=.github/scripts/dispatch/redact.sh
. "$(dirname "${BASH_SOURCE[0]}")/../dispatch/redact.sh"

: "${PR:?}" "${SHA:?}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
mkdir -p .dispatch/reports

if [ "${GITHUB_ACTIONS:-}" = true ]; then
  # The same workspace-trust acceptance as dispatch's run.sh.
  cfg="$HOME/.claude.json"
  [ -s "$cfg" ] || echo '{}' > "$cfg"
  jq --arg d "$PWD" '.projects[$d].hasTrustDialogAccepted = true' "$cfg" > "$cfg.new" \
    && mv "$cfg.new" "$cfg"
fi

prompt="/pr-review ${PR} ${SHA}
You are running unattended from GitHub Actions run ${RUN_URL:-<unknown>} (ADR-0046).
GH_TOKEN is a read-only token: every gh read works and every write fails, by design.
Node 20 and pnpm are already on PATH, and project dependencies are installed.
Copy the reviewer's full report to .dispatch/reports/pr-${PR}-${SHA:0:8}.md, which is uploaded as the pr-review-run artifact of this run. When the report is too large for the comment, the link reads: ${RUN_URL:-<unknown>} (artifact pr-review-run, reports/pr-${PR}-${SHA:0:8}.md).
This process exits when your turn ends. Run the reviewer in the foreground with run_in_background: false, and start no background shells or monitors."
printf '%s\n' "$prompt" > .dispatch/prompt.txt

# Same reason as dispatch's run.sh: a background task dies with the process.
export CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1
set +e
claude -p "$prompt" \
  --model "${DISPATCH_MODEL:-claude-opus-5-5}" \
  --effort "${DISPATCH_EFFORT:-high}" \
  --dangerously-skip-permissions \
  --output-format stream-json --verbose \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --disallowedTools Monitor \
  --forward-subagent-text \
  > .dispatch/transcript.jsonl 2> .dispatch/claude.err
status=$?
set -e
scrub .dispatch/transcript.jsonl
scrub .dispatch/claude.err
strip_spend .dispatch/transcript.jsonl

jq -R -c 'fromjson? | select(type == "object" and .type == "result")' \
  .dispatch/transcript.jsonl | tail -n 1 | jq -r '.result // empty' > .dispatch/report.md || true
{
  echo "## PR review (#$PR at ${SHA:0:8})"
  echo
  if [ -s .dispatch/report.md ]; then cat .dispatch/report.md; else echo "_No report text returned._"; fi
} >> "$summary"

if [ "$status" -ne 0 ]; then
  echo "claude -p exited $status; see the pr-review-run artifact" >&2
  tail -n 40 .dispatch/claude.err >&2
  exit "$status"
fi
