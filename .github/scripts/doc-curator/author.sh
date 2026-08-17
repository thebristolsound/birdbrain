#!/usr/bin/env bash
# Runs the author model once over the collected window and leaves its edit in
# the working tree. $1 = reviewer reasons from a rejected first pass ("" on the
# first pass). Inputs: .curator/{merges.txt,prs.json}. Env: CLAUDE_CODE_OAUTH_TOKEN,
# AUTHOR_MODEL, CURATOR_MARKER.
set -euo pipefail

reasons="${1:-}"
policy="$(cat docs/agents/doc-curator.md)"
guide="$(sed -n '/^## Claim discipline/,/^## Document types/p' docs/agents/writing-guide.md | sed '$d')"
prs="$(jq -r '.[] | "### PR #\(.number): \(.title)\n\(.body // "")\n"' .curator/prs.json)"
# The full diff is orientation only — a busy week runs to megabytes, so the author
# gets the diffstat and reads the tree itself (HEAD contains every merge).
stat="$(git --no-pager diff --stat=120 "${CURATOR_MARKER}..HEAD" -- . ':!website/content/docs' ':!pnpm-lock.yaml' ':!website/pnpm-lock.yaml' | tail -n 200)"

retry=""
if [ -n "$reasons" ]; then
  retry="A reviewer REJECTED your previous attempt for these reasons. Fix every one; do not argue with them:
- ${reasons}
"
fi

prompt="$(cat <<PROMPT
You are the doc curator for this repository. Read the policy below and obey the Author hard limits exactly. Edit files in place under website/content/docs/*.mdx and nothing else. Do not create files. Do not touch meta.json or docs.json.

${retry}
=== POLICY (docs/agents/doc-curator.md) ===
${policy}

=== WRITING GUIDE (excerpt) ===
${guide}

=== MERGED PRs SINCE LAST RUN ===
${prs}

=== MERGE COMMITS ===
$(cat .curator/merges.txt)

=== FILES CHANGED IN THE WINDOW (${CURATOR_MARKER:0:8}..HEAD) ===
${stat}

=== HOW TO WORK ===
This checkout is HEAD, so it already contains every merge above. Read the pages, then for each candidate drift read the code that decides it (\`git diff ${CURATOR_MARKER}..HEAD -- <path>\`, or the file itself). Take enum values, states, and option names literally from their type definitions — do not generalise from a PR body. Every edit must cite the PR number and a file:line you actually read.

=== YOUR OUTPUT ===
Make the edits directly in the files. Then, as your final message, output ONLY a JSON object:
{ "changes": [ { "page": "<file>", "section": "<heading>", "cites": ["<PR # or file:line>"], "summary": "<one line>" } ],
  "not_attempted": [ { "page": "<file>", "reason": "<one line>" } ] }
If nothing in the window changes any documented behaviour, make no edits and output {"changes":[],"not_attempted":[]}.
PROMPT
)"

# Edit tools are unrestricted by path here; anything written outside the docs
# pages is reverted below and recorded so the reviewer rejects the pass.
raw="$(claude -p --model "$AUTHOR_MODEL" \
  --tools "Read,Grep,Glob,Bash,Edit,Write" \
  --allowedTools "Read" "Grep" "Glob" "Edit" "Write" "Bash(git diff *)" "Bash(git show *)" "Bash(git log *)" \
  --permission-mode dontAsk --output-format json <<<"$prompt" 2> .curator/author.err)" || {
    echo "claude -p (author) failed; see .curator/author.err" >&2
    tail -n 40 .curator/author.err >&2
    exit 1
  }
printf '%s' "$raw" > .curator/author.raw
jq -r 'if type=="array" then (map(select(.type=="result")) | last | .result) else .result end // empty' <<<"$raw" \
  | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//' > .curator/author.json
jq -e '.changes' .curator/author.json >/dev/null 2>&1 || echo '{"changes":[],"not_attempted":[{"page":"*","reason":"author summary unparseable; see .curator/author.raw"}]}' > .curator/author.json
jq -r 'if type=="array" then (map(select(.type=="result")) | last | {cost:.total_cost_usd, turns:.num_turns, ms:.duration_ms}) else . end' <<<"$raw" > .curator/author.meta

# Untracked files are removed; tracked ones are restored. Doing both to a
# tracked file would restore it and then delete it.
stray_status="$(git status --porcelain --untracked-files=all | grep -v ' website/content/docs/.*\.mdx$' | grep -v ' \.curator/' || true)"
if [ -n "$stray_status" ]; then
  echo "Author touched files outside scope (reverted):" >&2
  echo "$stray_status" >&2
  awk '{print $2}' <<<"$stray_status" > .curator/stray.txt
  grep '^??' <<<"$stray_status" | awk '{print $2}' | xargs -r rm -rf
  grep -v '^??' <<<"$stray_status" | awk '{print $2}' | xargs -r git checkout -- 2>/dev/null || true
fi

git --no-pager diff --stat -- website/content/docs
