#!/usr/bin/env bash
# Run one cycle of the dispatch skill through headless Claude Code.
#
# $1 = mode (report | cycle). Env: CLAUDE_CODE_OAUTH_TOKEN, DISPATCH_MODEL, DISPATCH_EFFORT,
# RUN_URL, GH_TOKEN (machine token, the identity every gh call carries here),
# TARGET_ISSUE (optional, narrows section 3 to one issue).
#
# TARGET_ISSUE exists for a supervised fire. Section 3 walks the frontier in
# ascending order and takes the first eligible issue, which is the right rule
# unattended and the wrong one when a human wants a specific first subject. It
# narrows the choice and never widens it: the issue still has to pass every
# eligibility check, and failing one ends the cycle rather than falling through
# to the next candidate.
#
# The prompt is the skill invocation plus the facts the skill cannot probe for
# itself on this host, including where a reviewer's full report has to be left
# for the verdict comment's link to survive the runner.
#
# Project MCP servers are disabled: none are configured, and a server start on
# the runner would be startup time spent for nothing.
set -euo pipefail

# shellcheck source=.github/scripts/dispatch/redact.sh
. "$(dirname "${BASH_SOURCE[0]}")/redact.sh"
# Listed in full first: each scrub writes a .redacted file that a find still walking
# the folder could return.
scrub_reports() {
  local files f
  mapfile -d '' -t files < <(find .dispatch/reports -type f -print0)
  for f in "${files[@]}"; do scrub "$f"; done
}

mode="${1:-cycle}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
mkdir -p .dispatch/reports
# A leftover first-call result would be summed into this run's meta.json.
rm -f .dispatch/result-1.json .dispatch/claude-1.err .dispatch/report-1.md \
  .dispatch/transcript-1.jsonl

if [ "${GITHUB_ACTIONS:-}" = true ]; then
  # Every fire logged "Ignoring 33 permissions.allow entries ... this workspace has not
  # been trusted". The runner is the only user of this home directory.
  cfg="$HOME/.claude.json"
  [ -s "$cfg" ] || echo '{}' > "$cfg"
  jq --arg d "$PWD" '.projects[$d].hasTrustDialogAccepted = true' "$cfg" > "$cfg.new" \
    && mv "$cfg.new" "$cfg"

  # actions/checkout supplies the token through conditional includeIf entries, and the
  # harness refuses worktree isolation for a configuration that has them. Two fires
  # (37129293732, 37415689600) worked around it two different ways mid-cycle. A plain
  # include of the same credential file keeps pushes working; the checkout's post step
  # still deletes that file at the end of the job.
  mapfile -t inc < <(git config --local --get-regexp '^includeif\..*\.path$' || true)
  if [ "${#inc[@]}" -gt 0 ]; then
    file="${inc[0]#* }"
    for entry in "${inc[@]}"; do git config --local --unset-all "${entry%% *}"; done
    git config --local include.path "$file"
  fi
fi

context="You are running unattended from GitHub Actions run ${RUN_URL:-<unknown>} (ADR-0026).
The environment probe reads LOCAL here: nothing sits between gh and GitHub.
GH_TOKEN and the checkout's git credential are both the machine account, so bare gh and agh are the same identity, and the implementer pushes as the machine account over HTTPS.
Node 20 and pnpm are already on PATH; no mise prefix is needed.
The machine token carries repo scope and not gist scope, so a pre-pass 'Full report:' link cannot be a gist here. Copy each reviewer full report to .dispatch/reports/pr-<number>-<short sha>.md, which is uploaded as the dispatch-run artifact of this run, and make the link read: ${RUN_URL:-<unknown>} (artifact dispatch-run, reports/pr-<number>-<short sha>.md). The runner filesystem is gone once the job ends, so a bare path is not a link.
This process exits when your turn ends, and anything left running in the background dies with it. Run every subagent (Agent tool) call in the foreground with run_in_background: false, start no background shells or monitors, and wait for CI with bash .github/scripts/dispatch/checks.sh --wait 540 <pr>, repeated while it exits 124 (the Bash tool caps a command at ten minutes). End your turn only with the section 5 report, and start it with a heading line containing 'Dispatch cycle report': this runner treats a result without one as an unfinished cycle."

case "$mode" in
  report)
    prompt="/dispatch
MODE: REPORT-ONLY. Run the environment probe, the identity check, section 1 and the section 2 classification, then write the section 5 report. Post nothing, label nothing, spawn no agent, merge nothing. Wherever the contract says to write, state what you would have written instead.
$context"
    ;;
  cycle)
    target=""
    if [ -n "${TARGET_ISSUE:-}" ]; then
      target="
SECTION 3 IS NARROWED TO ISSUE #${TARGET_ISSUE}. Sections 1, 2 and 2a are unchanged. If you reach section 3, the only candidate you may claim or dispatch is #${TARGET_ISSUE}. Apply every eligibility check to it as written; if it fails one, or a slot is not free, report which check stopped you and dispatch nothing. Never fall through to another issue."
    fi
    prompt="/dispatch
$context$target"
    ;;
  *)
    echo "Unknown mode '$mode'" >&2
    exit 2
    ;;
esac

printf '%s\n' "$prompt" > .dispatch/prompt.txt
scrub .dispatch/prompt.txt

# `claude -p` exits the moment the model ends its turn, and whatever it left
# running in the background dies with the process. 20 of 122 completed cycles
# from 2026-09-07 to 09-25 ended on "Waiting on CI" or "the implementer is
# running in the background"; cleanup then released the claim and the next
# cycle found the round still owed. The variable drops run_in_background from
# the Agent and Bash tools. Monitor has no foreground form, so it goes too.
export CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1
# Binds the post-comment, post-commit-message and post-pr-body hooks to every session
# of the cycle, the top-level dispatcher included, which has no agent_type for them to
# match. Run 37129293732 posted a claim comment its linter had rejected.
export BIRDBRAIN_DISPATCH=1
flags=(
  --model "${DISPATCH_MODEL:-claude-opus-5-5}"
  --effort "${DISPATCH_EFFORT:-high}"
  --dangerously-skip-permissions
  --output-format stream-json --verbose
  --strict-mcp-config --mcp-config '{"mcpServers":{}}'
  --disallowedTools Monitor
  # Without it the stream carries a subagent's tool events and not its text, by the
  # flag's own description, and the reviewer's reasoning is what a retrospective reads.
  --forward-subagent-text
)

# $@ = the arguments that go ahead of the shared flags.
run_claude() {
  set +e
  # stream-json keeps every event of the session as the run's transcript. The
  # final-message envelope alone left a retrospective nothing to read but the cycle's
  # own account of itself.
  claude "$@" "${flags[@]}" > .dispatch/transcript.jsonl 2> .dispatch/claude.err
  status=$?
  set -e
  # Before anything here reads or echoes these files: the failure path is the one that
  # carries a credential, so redacting after it would redact nothing. A cancel or the
  # job timeout ends the run inside the call, before this line; the upload is covered
  # by dispatch.yml running scrub.sh first.
  scrub .dispatch/transcript.jsonl
  scrub .dispatch/claude.err
  strip_spend .dispatch/transcript.jsonl
  scrub_reports
  # The result event is the envelope the rest of this script reads. A call that failed
  # before emitting one leaves whatever it printed, which the failure path below shows.
  jq -R -c 'fromjson? | select(type == "object" and .type == "result")' \
    .dispatch/transcript.jsonl | tail -n 1 > .dispatch/result.json
  [ -s .dispatch/result.json ] || cp .dispatch/transcript.jsonl .dispatch/result.json

  if [ "$status" -ne 0 ]; then
    # Both streams, because a fast non-zero exit puts the reason on stdout as a
    # JSON error result and leaves stderr carrying only warnings. Run 34090872909
    # failed with nothing but the workspace-trust warning in the log, and the
    # artifact that held the answer had not uploaded.
    echo "claude -p exited $status; see the dispatch-run artifact" >&2
    echo "--- .dispatch/claude.err (last 40 lines) ---" >&2
    tail -n 40 .dispatch/claude.err >&2
    echo "--- .dispatch/result.json (first 4000 bytes) ---" >&2
    head -c 4000 .dispatch/result.json >&2 || true
    echo >&2
    exit "$status"
  fi
}

result_of() {
  jq 'if type=="array" then (map(select(.type=="result")) | last) else . end' "$1"
}

# Non-empty is not enough: every truncated cycle returned text. Real reports
# have opened with "## Dispatch cycle report", "**Dispatch cycle report — run
# …**" and "## End-of-cycle report", so any heading line naming it counts.
has_report() { grep -qiE '^[[:space:]]*(#+|\*\*).*cycle report' .dispatch/report.md; }

run_claude -p "$prompt"
result_of .dispatch/result.json | jq -r '.result // empty' > .dispatch/report.md

resumed=false
# An error result is not a cycle that stopped early, and the is_error exit
# below reports it; a resume would spend a second call on the same error.
if ! has_report && [ "$(result_of .dispatch/result.json | jq -r '.is_error // false')" != true ]; then
  session_id="$(result_of .dispatch/result.json | jq -r '.session_id // empty')"
  if [ -z "$session_id" ]; then
    echo "The cycle ended without a report heading and returned no session to resume" >&2
    exit 1
  fi
  # The first call's files stay in the artifact beside the resumed call's.
  mv .dispatch/result.json .dispatch/result-1.json
  mv .dispatch/claude.err .dispatch/claude-1.err
  mv .dispatch/transcript.jsonl .dispatch/transcript-1.jsonl
  mv .dispatch/report.md .dispatch/report-1.md
  resume="Your turn ended before the section 5 report. This is a headless run, so ending the turn ended the process: any background agent, shell, monitor or CI wait you were relying on no longer exists, and nothing it would have done has happened. Re-read the current state from GitHub (claims, PR heads, checks, comments) rather than trusting what you last saw, finish the cycle in the foreground under the same rules, and end your turn with the section 5 report."
  run_claude -p "$resume" --resume "$session_id"
  result_of .dispatch/result.json | jq -r '.result // empty' > .dispatch/report.md
  resumed=true
fi

# Summed over both calls when the cycle was resumed, so the figures are what
# the cycle spent and not what its second half spent. The spend is left out,
# because this file is printed in the run summary (#1369).
for f in .dispatch/result-1.json .dispatch/result.json; do
  if [ -f "$f" ]; then result_of "$f"; fi
done | jq -s '{is_error: (last | .is_error), turns: (map(.num_turns // 0) | add),
               ms: (map(.duration_ms // 0) | add), calls: length}' > .dispatch/meta.json

{
  echo "## Dispatch cycle ($mode)"
  echo
  if [ "$resumed" = true ]; then
    echo "_Resumed once: the first call ended without a report heading (report-1.md in the artifact)._"
    echo
  fi
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
if ! has_report; then
  echo "The cycle ended without a report heading after one resume; its round is unfinished" >&2
  exit 1
fi
