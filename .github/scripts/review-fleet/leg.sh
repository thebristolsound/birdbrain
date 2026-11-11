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
# the process environment and `--output` writes files. The diff, the commit history, the stack
# below the head, the repository's files before the change and the sources come in as files
# instead, written here before the paid call. No file is written by the session: the answer
# comes back as structured output, checked against the pass's schema.
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
# The pass's name travels with its output. A lone artifact is downloaded with no directory of
# its own, so collect.sh places each output by this file, not by where it landed.
printf '%s\n' "$leg" > "$OUT/pass"
head="$(git -C "$PR_DIR" rev-parse HEAD)"
[ "$head" = "$SHA" ] || { echo "checked out $head, expected $SHA" >&2; exit 1; }
base="$(git -C "$PR_DIR" merge-base origin/main HEAD)"
# Attributes come from an empty tree and no diff program runs, so a .gitattributes in the pull
# request cannot mark a file as binary and empty its hunks from the diff the pass reviews.
no_attributes="$(git -C "$PR_DIR" hash-object -t tree /dev/null)"
git -C "$PR_DIR" --attr-source="$no_attributes" diff --no-ext-diff --no-textconv "$base" HEAD \
  > "$in/diff.patch"
gh pr view "$PR" -R "$R" --json title,body,commits \
  --jq '{title, body, commits: [.commits[] | {oid, messageHeadline, messageBody}]}' > "$in/pr.json"
cp "$here/../../../CLAUDE.md" "$in/rules.md"
# Required issues, referenced review contracts and the maintainer's and machine account's
# comments on them are fetched before paid work.
node "$here/inputs.mjs" "$R" "$in"
# The commits past main, a patch for each, the pull requests below the head, the diff against a
# base branch other than main, and the repository's files before the change.
node "$here/history.mjs" "$R" "$PR" "$PR_DIR" "$in"
# The scope this pass reads goes with its output, so the head's record says what was reviewed.
mv "$in/scope.json" "$OUT/scope.json"
if [ "$leg" = verify-codex ]; then
  node "$here/fleet.mjs" codex-findings "$R" "$PR" "$SHA" > "$in/codex.json"
fi
if [ -f "$in/diff-base.patch" ]; then
  scope="- \`$in/diff-base.patch\`: the diff from the merge base with the base branch to the head. The base branch is not \`main\`, so this is the pull request's own change and your review scope."
else
  scope="- The base branch is \`main\`, so \`diff.patch\` is your review scope and there is no \`diff-base.patch\`."
fi
if [ -d "$in/base-branch-tree" ]; then
  before="- \`$in/base-branch-tree/\`: the repository as it stood before this change: every file at the merge base with the base branch. Check a \"before this change\" citation there.
- \`$in/base-tree/\`: the repository as it stood on \`main\`, below this pull request and the ones under it: every file at the merge base with \`main\`. Check an \"on main\" citation there."
else
  before="- \`$in/base-tree/\`: the repository as it stood before this change: every file at the merge base with \`main\`. Check a \"before this change\" or \"on main\" citation there."
fi

prompt="$(cat "$here/prompts/common.md" "$prompt_file")

## Inputs

- The pull request's head commit \`$SHA\` is checked out in the working directory.
- \`$in/diff.patch\`: the diff from the merge base with \`main\` to the head.
$scope
- \`$in/pr.json\`: the title, body and commits.
- \`$in/rules.md\`: this repository's \`CLAUDE.md\` from \`main\`.
- \`$in/sources.json\`: all closed issues and referenced issues, pull requests and review contracts, each with its author, its date and the comments the maintainer and the machine account wrote on it; read every entry.
- \`$in/commits.json\`: every commit from the merge base with \`main\` to the head, oldest first, with its parents, author date, subject, the files it changed against its first parent, the pull request it belongs to, whether the base branch has it, and for a merge whether it is git's automatic merge.
- \`$in/commits/\`: one patch per commit against its first parent, at the path \`commits.json\` gives.
- \`$in/stack.json\`: the base branch, the commits that are this pull request's own, and the pull requests below it, open or recently closed, with the commits of each.
$before
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
