#!/usr/bin/env bash
# Squash-merge one PR the way ADR-0022 expects, then read back what landed.
#   merge.sh <pr-number> [--cli gh|agh] [--dry-run]
# --cli agh runs every GitHub write as the machine account (ADR-0027); the dispatcher uses it.
# --dry-run stops after composing the subject and body.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${CLAUDE_PROJECT_DIR:-$(git -C "$here" rev-parse --show-toplevel)}"
body_check="$root/.claude/skills/post-pr-body/scripts/check.sh"

n="" cli="gh" dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cli) cli="$2"; shift 2 ;;
    --cli=*) cli="${1#--cli=}"; shift ;;
    --dry-run) dry=1; shift ;;
    -*) echo "merge-pr: unknown flag $1" >&2; exit 2 ;;
    *) n="$1"; shift ;;
  esac
done
[ -n "$n" ] || { echo "usage: merge.sh <pr-number> [--cli gh|agh] [--dry-run]" >&2; exit 2; }
case "$cli" in gh|agh) ;; *) echo "merge-pr: --cli must be gh or agh" >&2; exit 2 ;; esac
if [ "$cli" = "agh" ]; then
  # agh is a shell function on the maintainer's machine (docs/agents/github-access.md); a script
  # has to define it from the same token and prove the identity before any write (ADR-0027).
  [ -n "${BIRDBRAIN_AGENT_GH_TOKEN:-}" ] || { echo "merge-pr: BIRDBRAIN_AGENT_GH_TOKEN is not set; see docs/agents/github-access.md" >&2; exit 2; }
  agh() { GH_TOKEN="$BIRDBRAIN_AGENT_GH_TOKEN" gh "$@"; }
  login="$(agh api user --jq .login)"
  [ "$login" = "${BIRDBRAIN_AGENT_GH_LOGIN:-birdbrain-agent}" ] || { echo "merge-pr: agh authenticates as '$login', not the machine account" >&2; exit 2; }
fi

fail() { echo "merge-pr: refused: $*" >&2; exit 1; }
say() { echo "merge-pr: $*"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# 1. The PR as it is now (REST, not GraphQL: docs/agents/github-access.md).
"$cli" api "repos/{owner}/{repo}/pulls/$n" > "$work/pr.json" || fail "cannot read PR #$n"
field() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=process.argv[2].split(".").reduce((o,k)=>o==null?o:o[k], j); process.stdout.write(v==null?"":(typeof v==="object"?JSON.stringify(v):String(v)))' "$work/pr.json" "$1"; }
state="$(field state)"; draft="$(field draft)"; title="$(field title)"; head_ref="$(field head.ref)"
head_sha="$(field head.sha)"; base_ref="$(field base.ref)"; merged="$(field merged)"
head_repo="$(field head.repo.full_name)"; base_repo="$(field base.repo.full_name)"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(j.body||"")' "$work/pr.json" > "$work/body.md"
labels="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(j.labels.map(l=>l.name).join(" "))' "$work/pr.json")"

[ "$state" = "open" ] || fail "PR #$n is $state (merged=$merged)"
[ "$base_ref" = "main" ] || fail "base is $base_ref, not main"
say "PR #$n  $title"
say "head $head_ref @ ${head_sha:0:12}  draft=$draft  labels: ${labels:-none}"

# 2. Checks at head. The gate is the required status checks of the rules that apply to main, read
#    from the API, so a red check the ruleset does not require warns instead of blocking every
#    merge (#1331). Every required context needs a green check run or commit status, and a
#    missing one refuses. pregate.sh reads the same rules with jq; each script keeps its own
#    parser (node here, jq there) rather than sourcing across the skill and workflow trees.
"$cli" api "repos/{owner}/{repo}/rules/branches/main" > "$work/rules.json" || fail "cannot read the rules for main, so the required checks are unknown"
"$cli" api "repos/{owner}/{repo}/commits/$head_sha/check-runs?per_page=100" > "$work/checks.json" || fail "cannot read check runs"
"$cli" api "repos/{owner}/{repo}/commits/$head_sha/status?per_page=100" > "$work/status.json" || fail "cannot read commit statuses"
verdict="$(node -e '
const [rules,checks,status]=process.argv.slice(1,4).map(f=>JSON.parse(require("fs").readFileSync(f,"utf8")))
const required=[...new Set(rules.filter(r=>r.type==="required_status_checks").flatMap(r=>(r.parameters.required_status_checks||[]).map(s=>s.context)))]
const ok=new Set(["success","skipped","neutral"])
const seen=[
  ...checks.check_runs.map(c=>({name:c.name,green:c.status==="completed"&&ok.has(c.conclusion),text:`${c.name}=${c.status}/${c.conclusion}`})),
  ...status.statuses.map(s=>({name:s.context,green:s.state==="success",text:`${s.context}=${s.state}`}))
]
const bad=required.flatMap(name=>{const mine=seen.filter(s=>s.name===name); return mine.length?mine.filter(s=>!s.green).map(s=>s.text):[`${name}=missing`]})
const other=seen.filter(s=>!required.includes(s.name)&&!s.green).map(s=>s.text)
process.stdout.write([required.join(", "),bad.join(" "),other.join(" "),checks.total_count].join("\n")+"\n")' \
  "$work/rules.json" "$work/checks.json" "$work/status.json")" || fail "cannot parse the rules, check runs or statuses"
{ read -r required; read -r bad_checks; read -r other_bad; read -r runs; } <<<"$verdict"
[ -n "$required" ] || fail "the rules for main name no required status checks, so nothing defines green; refusing rather than guessing"
if [ "$runs" -eq 0 ]; then
  # CI skips a draft unless it carries the agent labels (ci.yml); marking it ready starts the run.
  if [ "$draft" = "true" ]; then
    if [ "$dry" -eq 1 ]; then
      say "draft with no check runs: a real run marks it ready, waits for CI, and stops here"
    else
      "$cli" pr ready "$n" || fail "could not mark ready"
      fail "no check runs at head ${head_sha:0:12}; the PR is now ready for review and CI is starting. Re-run once it is green"
    fi
  else
    fail "no check runs at head ${head_sha:0:12}; CI has not run on this commit, so nothing is green"
  fi
else
  [ -z "$bad_checks" ] || fail "required checks not green at head: $bad_checks"
  [ -z "$other_bad" ] || say "WARN checks not required on main and not green at head: $other_bad"
  say "required checks green at head: $required ($runs runs)"
fi

# 3. The body passes the PR body shape (the linter tolerates a cloud-proxy footer after the
# attribution line). Under gh the author may be human, so the attribution line is optional.
any_author=""; [ "$cli" = "gh" ] && any_author="--any-author"
# shellcheck disable=SC2086
"$body_check" $any_author "$work/body.md" || fail "the body does not pass post-pr-body; fix it with '$cli pr edit $n --body-file <file>' first"
say "body passes post-pr-body"

# 4. Evidence-affecting: the machine account never merges one (ADR-0005, ADR-0014).
# Only a "Closes" first line names issues; "No issue: follow-up to #N" closes nothing.
closes=""
case "$(head -1 "$work/body.md")" in
  Closes\ *) closes="$(head -1 "$work/body.md" | grep -oE '#[0-9]+' | tr -d '#' | tr '\n' ' ')" ;;
esac
evidence=""
case " $labels " in *" evidence-affecting "*) evidence="PR label" ;; esac
for i in $closes; do
  # Captured first so an API failure refuses rather than reading as "no label".
  issue_labels="$("$cli" api "repos/{owner}/{repo}/issues/$i/labels" --jq '.[].name')" || fail "cannot read the labels of issue #$i"
  if printf '%s\n' "$issue_labels" | grep -qx 'evidence-affecting'; then
    evidence="${evidence:+$evidence, }issue #$i label"
  fi
done
if [ -n "$evidence" ]; then
  [ "$cli" = "agh" ] && fail "evidence-affecting ($evidence): human review and a human merge only"
  say "evidence-affecting ($evidence): merging as the human reviewer"
fi

# 4b. The maintainer's own PR: main requires a code-owner approval GitHub will not let its author
#     give, so it merges through the admin bypass, and only on a success pre-pass at this head.
admin=""
if [ "$cli" = "gh" ]; then
  author="$(field user.login)"
  me="$(gh api user --jq .login)" || fail "cannot read the gh login"
  if [ -n "$author" ] && [ "$author" = "$me" ]; then
    prepass="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const p=s.statuses.find(x=>x.context==="agent/pre-pass"); process.stdout.write(p?p.state:"missing")' "$work/status.json")"
    [ "$prepass" = "success" ] || fail "PR #$n is authored by $me, so it merges through the admin bypass, which needs a success agent/pre-pass at head (it is $prepass)"
    admin="--admin"
    say "authored by $me: merging with the admin bypass on a success pre-pass"
  fi
fi

# 5. Subject and body for the squash commit.
node "$here/compose.mjs" "$work/body.md" "$title" "$n" "$work" > "$work/composed.txt" || fail "cannot compose the merge message"
say "merge message:"; sed 's/^/    /' "$work/composed.txt"
if [ "$dry" -eq 1 ]; then say "dry run: stopping before 'pr ready' and 'pr merge'"; exit 0; fi

# 6. Merge. --match-head-commit refuses if the head moved since step 1. No --delete-branch:
#    gh would also try to switch the local branch, which fails inside a worktree; the repository's
#    delete_branch_on_merge removes the remote branch and step 8 handles the local one.
if [ "$draft" = "true" ]; then "$cli" pr ready "$n" || fail "could not mark ready"; fi
# shellcheck disable=SC2086
"$cli" pr merge "$n" --squash $admin --match-head-commit "$head_sha" --subject "$(cat "$work/subject.txt")" --body-file "$work/body.txt" \
  || fail "merge command failed; read the PR before retrying"

# 7. Read back what landed rather than asserting it.
"$cli" api "repos/{owner}/{repo}/pulls/$n" > "$work/after.json"
merge_sha="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(j.merged?j.merge_commit_sha:"")' "$work/after.json")"
[ -n "$merge_sha" ] || fail "PR #$n does not report merged after the merge command"
git -C "$root" fetch -q origin main
say "merged as $(git -C "$root" log -1 --format='%h %s' "$merge_sha")"
if [ "$head_repo" != "$base_repo" ]; then
  say "head branch lives in $head_repo, not this repository; leaving it to its owner"
elif git -C "$root" ls-remote --exit-code --heads origin "$head_ref" >/dev/null 2>&1; then
  "$cli" api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$head_ref" && say "remote branch $head_ref deleted" || say "WARN remote branch $head_ref still exists"
else
  say "remote branch $head_ref deleted"
fi
for i in $closes; do
  st="$("$cli" api "repos/{owner}/{repo}/issues/$i" --jq .state)"
  [ "$st" = "closed" ] && say "issue #$i closed" || say "WARN issue #$i is $st; GitHub closes it on merge to the default branch, re-read in a moment"
done

# 8. Local cleanup: prune, then close the worktree holding the branch (the teardown skill decides
#    whether its lane allows removal and deletes the branch with it), or drop the branch directly.
git -C "$root" fetch -q --prune origin
if git -C "$root" show-ref --verify --quiet "refs/heads/$head_ref"; then
  holder="$(git -C "$root" worktree list --porcelain | awk -v b="refs/heads/$head_ref" '$1=="worktree"{w=$2} $1=="branch"&&$2==b{print w}')"
  if [ -n "$holder" ]; then
    (cd "$root" && "$root/.claude/skills/teardown/scripts/teardown.sh" close --branch "$head_ref" --merged "$head_sha") \
      || say "local branch $head_ref stays checked out in $holder; teardown gave the reason above"
  else
    # A squash leaves no ancestry, so -d refuses; the forced delete is safe only when the local
    # tip is the sha that was just merged.
    local_tip="$(git -C "$root" rev-parse "refs/heads/$head_ref")"
    if [ "$local_tip" = "$head_sha" ]; then
      git -C "$root" branch -D "$head_ref" >/dev/null && say "local branch $head_ref deleted" || say "WARN could not delete local branch $head_ref"
    else
      say "WARN local branch $head_ref is at ${local_tip:0:12}, not the merged ${head_sha:0:12}; leaving it"
    fi
  fi
else
  say "no local branch $head_ref"
fi
say "done"
