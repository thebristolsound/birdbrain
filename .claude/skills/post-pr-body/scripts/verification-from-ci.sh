#!/usr/bin/env bash
# Prints the Verification block for a PR nobody preflighted locally: a dependabot or human PR
# whose checks ran only in CI. Usage: verification-from-ci.sh <pr-number> [--cli gh|agh]
# It reads the required status checks of main's rules and the check runs at the PR head, and
# exits 1 unless every required check is green there, so the block it prints is only ever
# `pass`. Append it to a body whose other sections are written, then `pr edit --body-file`.
# The marker carries `source=ci`, so a reader can tell it from a `pnpm preflight` block.
set -u

n="" cli="gh"
while [ $# -gt 0 ]; do
  case "$1" in
    --cli) cli="$2"; shift 2 ;;
    --cli=*) cli="${1#--cli=}"; shift ;;
    -*) echo "verification-from-ci: unknown flag $1" >&2; exit 2 ;;
    *) n="$1"; shift ;;
  esac
done
[ -n "$n" ] || { echo "usage: verification-from-ci.sh <pr-number> [--cli gh|agh]" >&2; exit 2; }
case "$cli" in gh|agh) ;; *) echo "verification-from-ci: --cli must be gh or agh" >&2; exit 2 ;; esac
if [ "$cli" = "agh" ]; then
  [ -n "${BIRDBRAIN_AGENT_GH_TOKEN:-}" ] || { echo "verification-from-ci: BIRDBRAIN_AGENT_GH_TOKEN is not set; see docs/agents/github-access.md" >&2; exit 2; }
  agh() { GH_TOKEN="$BIRDBRAIN_AGENT_GH_TOKEN" gh "$@"; }
fi

fail() { echo "verification-from-ci: $*" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

head_sha="$("$cli" api "repos/{owner}/{repo}/pulls/$n" --jq .head.sha)" || fail "cannot read PR #$n"
"$cli" api "repos/{owner}/{repo}/rules/branches/main" > "$work/rules.json" || fail "cannot read the rules for main, so the required checks are unknown"
"$cli" api "repos/{owner}/{repo}/commits/$head_sha/check-runs?per_page=100" > "$work/checks.json" || fail "cannot read check runs"
"$cli" api "repos/{owner}/{repo}/commits/$head_sha/status?per_page=100" > "$work/status.json" || fail "cannot read commit statuses"

node - "$work/rules.json" "$work/checks.json" "$work/status.json" "$head_sha" <<'NODE'
const fs = require('fs')
const [rules, checks, status] = process.argv.slice(2, 5).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
const sha = process.argv[5]
const required = [
  ...new Set(
    rules
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => (r.parameters.required_status_checks || []).map((s) => s.context))
  )
]
if (!required.length) {
  console.error('verification-from-ci: the rules for main name no required status checks; refusing rather than guessing')
  process.exit(1)
}
const ok = new Set(['success', 'skipped', 'neutral'])
const runId = (c) => (c.details_url || '').match(/\/actions\/runs\/(\d+)/)?.[1]
const seen = [
  ...checks.check_runs.map((c) => ({
    name: c.name,
    green: c.status === 'completed' && ok.has(c.conclusion),
    text: `${c.status}/${c.conclusion}`,
    where: runId(c) ? `run ${runId(c)}` : `check run ${c.id}`
  })),
  ...status.statuses.map((s) => ({ name: s.context, green: s.state === 'success', text: s.state, where: 'commit status' }))
]
const lines = []
const bad = []
for (const name of required) {
  const mine = seen.filter((s) => s.name === name)
  if (!mine.length) { bad.push(`${name}=missing`); continue }
  // A re-run leaves several check runs with one name; any green one at this sha is green.
  const green = mine.find((s) => s.green)
  if (!green) { bad.push(`${name}=${mine[0].text}`); continue }
  lines.push(`- \`${name}\` - pass (${green.where})`)
}
if (bad.length) {
  console.error(`verification-from-ci: required checks not green at ${sha.slice(0, 12)}: ${bad.join(' ')}`)
  process.exit(1)
}
process.stdout.write(
  [
    `<!-- preflight v1 sha=${sha} status=pass source=ci -->`,
    '## Verification',
    '',
    '<details>',
    '<summary>All pre-merge checks passed</summary>',
    '',
    `The required checks of \`main\` at \`${sha}\`, read from CI; no local run, because no agent authored this pull request. Result: **pass**.`,
    '',
    ...lines,
    '',
    '</details>',
    ''
  ].join('\n')
)
NODE
