#!/usr/bin/env bash
# Run one Claude pass of the review fleet (ADR-0057) and leave its JSON in $OUT/findings.json.
#
# $1 = the pass: correctness | claims | contract | tests | verify-codex.
# Env: PR, SHA, PR_DIR (the PR's head checked out), CLAUDE_CODE_OAUTH_TOKEN, REVIEW_FLEET_MODEL,
# REVIEW_FLEET_EFFORT, OUT, and GH_TOKEN, the job's read-only token.
#
# The session runs in the PR's tree with only user settings loaded (--setting-sources user), so
# a PR's own .claude/ settings and hooks never load next to the credential. It may read, grep and
# glob files, and nothing else. It gets no shell, not even git: `git diff --no-index` can print
# the process environment and `--output` writes files. The diff, commits and issue come in as
# files instead. No file is written: the answer comes back as structured output, checked against
# the pass's schema.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.github/scripts/dispatch/redact.sh
. "$here/../dispatch/redact.sh"

leg="${1:?usage: leg.sh <pass>}"
: "${PR:?}" "${SHA:?}" "${PR_DIR:?}" "${OUT:?}"
R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
prompt_file="$here/prompts/$leg.md"
[ -f "$prompt_file" ] || { echo "no prompt for pass $leg" >&2; exit 2; }
schema="$here/schemas/findings.json"
[ "$leg" = verify-codex ] && schema="$here/schemas/rulings.json"

in="$(mktemp -d)"
mkdir -p "$OUT"
head="$(git -C "$PR_DIR" rev-parse HEAD)"
[ "$head" = "$SHA" ] || { echo "checked out $head, expected $SHA" >&2; exit 1; }
base="$(git -C "$PR_DIR" merge-base origin/main HEAD)"
git -C "$PR_DIR" diff "$base" HEAD > "$in/diff.patch"
gh pr view "$PR" -R "$R" --json title,body,commits \
  --jq '{title, body, commits: [.commits[] | {oid, messageHeadline, messageBody}]}' > "$in/pr.json"
cp "$here/../../../CLAUDE.md" "$in/rules.md"
# Required issues and explicitly referenced review contracts are fetched before paid work.
node "$here/inputs.mjs" "$R" "$in"
if [ "$leg" = verify-codex ]; then
  node "$here/fleet.mjs" codex-findings "$R" "$PR" "$SHA" > "$in/codex.json"
fi

prompt="$(cat "$here/prompts/common.md" "$prompt_file")

## Inputs

- The pull request's head commit \`$SHA\` is checked out in the working directory.
- \`$in/diff.patch\`: the diff from the merge base with \`main\` to the head.
- \`$in/pr.json\`: the title, body and commits.
- \`$in/rules.md\`: this repository's \`CLAUDE.md\` from \`main\`.
- \`$in/sources.json\`: all closed issues and referenced review contracts; read every entry.
$( [ -f "$in/codex.json" ] && echo "- \`$in/codex.json\`: Codex's findings, the claims you check." || true )"

cd "$PR_DIR"
export CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1
set +e
claude -p "$prompt" \
  --model "${REVIEW_FLEET_MODEL:-claude-opus-5-5}" \
  --effort "${REVIEW_FLEET_EFFORT:-high}" \
  --setting-sources user \
  --add-dir "$in" \
  --permission-mode dontAsk \
  --allowedTools 'Read' 'Grep' 'Glob' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --json-schema "$(cat "$schema")" \
  --output-format stream-json --verbose \
  > "$OUT/transcript.jsonl" 2> "$OUT/claude.err"
status=$?
set -e
scrub "$OUT/transcript.jsonl"
scrub "$OUT/claude.err"
strip_spend "$OUT/transcript.jsonl"
[ "$status" -eq 0 ] || { echo "pass $leg failed (claude exited $status)" >&2; exit 1; }

jq -R -c 'fromjson? | select(type == "object" and .type == "result") | .structured_output // empty' \
  "$OUT/transcript.jsonl" | tail -n 1 > "$OUT/findings.json.tmp" || true
if [ -s "$OUT/findings.json.tmp" ]; then
  redact < "$OUT/findings.json.tmp" > "$OUT/findings.json"
fi
rm -f "$OUT/findings.json.tmp"

if [ ! -s "$OUT/findings.json" ]; then
  echo "pass $leg returned no structured output (claude exited $status)" >&2
  tail -n 40 "$OUT/claude.err" >&2
  exit 1
fi
{
  echo "## Review fleet: $leg (#$PR at ${SHA:0:8})"
  echo
  jq -r 'if .findings then (.findings[] | "- \(.severity): \(.plain)")
    else (.rulings[] | "- \(.id): \(.ruling) - \(.reason)") end,
    ("### Runtime limitations (not verified)"), (.runtime_limitations[]? | "- \(.)"),
    ("### Unfinished source review"), (.not_checked[]? | "- \(.)")' "$OUT/findings.json"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
