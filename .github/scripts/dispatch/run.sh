#!/usr/bin/env bash
# Run one cycle of the dispatch skill through headless Claude Code.
#
# $1 = mode (report | cycle). Env: CLAUDE_CODE_OAUTH_TOKEN, DISPATCH_MODEL,
# RUN_URL, GH_TOKEN (machine token, the identity every gh call carries here).
#
# The prompt is the skill invocation plus the facts the skill cannot probe for
# itself on this host, including where a reviewer's full report has to be left
# for the verdict comment's link to survive the runner.
#
# Project MCP servers are disabled: .mcp.json starts Serena through uvx, which is
# not on the runner, and a failed server start is startup time spent for nothing.
# The implementer's Serena tools therefore do not resolve here, which its
# contract already tolerates.
set -euo pipefail

mode="${1:-cycle}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
mkdir -p .dispatch/reports

context="You are running unattended from GitHub Actions run ${RUN_URL:-<unknown>} (ADR-0026).
The environment probe reads LOCAL here: nothing sits between gh and GitHub.
GH_TOKEN and the checkout's git credential are both the machine account, so bare gh and agh are the same identity, and the implementer pushes as the machine account over HTTPS.
Serena is not available on this host; its tools will not resolve. Node 20 and pnpm are already on PATH; no mise prefix is needed.
The machine token carries repo scope and not gist scope, so a pre-pass 'Full report:' link cannot be a gist here. Copy each reviewer full report to .dispatch/reports/pr-<number>-<short sha>.md, which is uploaded as the dispatch-run artifact of this run, and make the link read: ${RUN_URL:-<unknown>} (artifact dispatch-run, reports/pr-<number>-<short sha>.md). The runner filesystem is gone once the job ends, so a bare path is not a link."

case "$mode" in
  report)
    prompt="/dispatch
MODE: REPORT-ONLY. Run the environment probe, the identity check, section 1 and the section 2 classification, then write the section 5 report. Post nothing, label nothing, spawn no agent, merge nothing. Wherever the contract says to write, state what you would have written instead.
$context"
    ;;
  cycle)
    prompt="/dispatch
$context"
    ;;
  *)
    echo "Unknown mode '$mode'" >&2
    exit 2
    ;;
esac

printf '%s\n' "$prompt" > .dispatch/prompt.txt

set +e
claude -p "$prompt" \
  --model "${DISPATCH_MODEL:-claude-opus-5}" \
  --dangerously-skip-permissions \
  --output-format json \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  > .dispatch/result.json 2> .dispatch/claude.err
status=$?
set -e

if [ "$status" -ne 0 ]; then
  echo "claude -p exited $status; see the dispatch-run artifact" >&2
  tail -n 40 .dispatch/claude.err >&2
  exit "$status"
fi

jq -r 'if type=="array" then (map(select(.type=="result")) | last) else . end
       | .result // empty' .dispatch/result.json > .dispatch/report.md
jq -r 'if type=="array" then (map(select(.type=="result")) | last) else . end
       | {is_error, cost: .total_cost_usd, turns: .num_turns, ms: .duration_ms}' \
  .dispatch/result.json > .dispatch/meta.json

{
  echo "## Dispatch cycle ($mode)"
  echo
  if [ -s .dispatch/report.md ]; then cat .dispatch/report.md; else echo "_No report text returned._"; fi
  echo
  echo '```json'
  cat .dispatch/meta.json
  echo '```'
} >> "$summary"

if [ "$(jq -r '.is_error // false' .dispatch/meta.json)" = true ]; then
  echo "Claude reported is_error=true" >&2
  exit 1
fi
[ -s .dispatch/report.md ] || { echo "The cycle returned no report" >&2; exit 1; }
