#!/usr/bin/env bash
# Judges the current working-tree edit. Prints "approve" or "reject" on stdout and
# writes .curator/verdict.json. Mechanical failures (doc-budget, stray files)
# reject without spending a reviewer call. The reviewer gets read-only tools on the
# checkout instead of an in-prompt diff: a week's diff can run to megabytes and a
# truncated one hides exactly the hunk a claim needs. Env: CLAUDE_CODE_OAUTH_TOKEN,
# REVIEWER_MODEL, CURATOR_MARKER.
set -euo pipefail

reasons=()
if [ -f .curator/budget.json ] && [ "$(jq -r .ok .curator/budget.json)" != "true" ]; then
  while IFS= read -r line; do reasons+=("$line"); done < <(jq -r '.failures[] | "doc-budget [\(.rule)] \(.path): \(.detail)"' .curator/budget.json)
fi
if [ -s .curator/stray.txt ]; then
  reasons+=("wrote outside website/content/docs/*.mdx: $(tr '\n' ' ' < .curator/stray.txt)")
fi
if git diff --quiet -- website/content/docs; then
  # No edit is a valid outcome, not a rejection; the workflow treats an empty diff
  # as a no-op PR-less approve.
  jq -n '{verdict:"approve",reasons:["no edit proposed"]}' > .curator/verdict.json
  echo approve
  exit 0
fi
if [ "${#reasons[@]}" -gt 0 ]; then
  printf '%s\n' "${reasons[@]}" | jq -R . | jq -s '{verdict:"reject",reasons:.}' > .curator/verdict.json
  echo reject
  exit 0
fi

policy="$(sed -n '/^## Reviewer lenses/,/^## Flow/p' docs/agents/doc-curator.md | sed '$d')"
guide="$(sed -n '/^## Claim discipline/,/^## Document types/p' docs/agents/writing-guide.md | sed '$d')"
avoid="$(grep -n -i '_avoid_' CONTEXT.md || true)"
edit="$(git --no-pager diff -- website/content/docs)"
prs="$(jq -r '.[] | "### PR #\(.number): \(.title)\n\(.body // "")\n"' .curator/prs.json)"
stat="$(git --no-pager diff --stat=120 "${CURATOR_MARKER}..HEAD" -- . ':!website/content/docs' ':!pnpm-lock.yaml' ':!website/pnpm-lock.yaml' | tail -n 200)"
author="$(cat .curator/author.json 2>/dev/null || echo '{}')"

prompt="$(cat <<PROMPT
You are an adversarial reviewer. Another model edited published reference docs to reflect merged code. Your job is to REFUTE the edit. Default to reject when uncertain.

${policy}

=== WRITING GUIDE (excerpt) ===
${guide}

=== CONTEXT.md _Avoid_ lines ===
${avoid}

=== THE EDIT (unified diff) ===
${edit}

=== AUTHOR'S OWN SUMMARY ===
${author}

=== MERGED PRs IN THE WINDOW ===
${prs}

=== FILES CHANGED IN THE WINDOW (${CURATOR_MARKER:0:8}..HEAD) ===
${stat}

=== HOW TO VERIFY ===
You have read-only tools on this checkout (HEAD includes every merge in the window). For EVERY factual claim the edit adds or changes, locate the code that supports it — Read the file, Grep for the identifier, or run \`git diff ${CURATOR_MARKER}..HEAD -- <path>\`. A claim you cannot locate in the tree is unsupported. Check enum values, states, and option names literally against their type definitions and comments; near-misses are the common failure.

Respond with ONLY a JSON object, no prose, no code fence:
{ "verdict": "approve" | "reject", "reasons": [ "<lens>: <specific text> — <file:line that supports or refutes it>" ] }
On approve, reasons lists one entry per claim you verified, with its file:line. On reject, every reason quotes the offending text and the evidence. Approve only if all four lenses pass.
PROMPT
)"

raw="$(claude -p --model "$REVIEWER_MODEL" --tools "Read,Grep,Glob,Bash" --allowedTools "Read" "Grep" "Glob" "Bash(git diff *)" "Bash(git show *)" "Bash(git log *)" --permission-mode dontAsk --output-format json <<<"$prompt" 2> .curator/review.err)"
# --output-format json emits either {result:...} or an event array whose last
# "result" event carries the text; the text itself is the verdict JSON.
printf '%s' "$raw" > .curator/review.raw
text="$(jq -r 'if type=="array" then (map(select(.type=="result")) | last | .result) else .result end // empty' <<<"$raw" 2>/dev/null || true)"
[ -z "$text" ] && text="$raw"
text="$(sed -e 's/^```json//' -e 's/^```//' -e 's/```$//' <<<"$text")"
if jq -e '.verdict' <<<"$text" >/dev/null 2>&1; then
  jq . <<<"$text" > .curator/verdict.json
else
  jq -n --arg t "$text" '{verdict:"reject",reasons:["reviewer returned unparseable output: " + $t]}' > .curator/verdict.json
fi
jq -r '.verdict' .curator/verdict.json
