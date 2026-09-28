#!/usr/bin/env bash
# Read-only rehearsal of the public cutover runbook
# (docs/plans/2026-09-28-public-cutover-runbook.md). It makes every check the runbook can make
# without changing anything, prints GO or NO-GO per check, and exits 1 when any check is NO-GO.
#
# Every GitHub read goes through get(), which is `gh api --method GET`. git only reads the remote
# (ls-remote, clone --mirror) and writes into a temporary directory removed on exit. There is no
# push, no workflow disable and no visibility change; tests/cutoverDryRun.test.ts pins that.
#
# Usage: scripts/cutover/dry-run.sh
# Env:   CUTOVER_REPO    owner/name, default thebristolsound/birdbrain
#        CUTOVER_REMOTE  git URL the bundle is built from, default the repository's https URL
set -euo pipefail

repo=${CUTOVER_REPO:-thebristolsound/birdbrain}
remote=${CUTOVER_REMOTE:-https://github.com/$repo.git}

# The 20 branches the maintainer ruled for deletion on #1370, and the one kept under its
# exclusion of Shared Case and persona work.
delete_branches=(
  backup/local-merge-230-231
  backup/pre-sync-diagnostic-logging
  backup/simplify-f8fb6f1
  coderabbitai/docstrings/9f4bb7c
  stash-archive/1
  stash-archive/2
  stash-archive/4
  stash-archive/5
  stash-archive/6
  stash-archive/7
  stash-archive/8
  stash-archive/9
  stash-archive/10
  stash-archive/11
  stash-archive/12
  stash-archive/14
  stash-archive/15
  t3code/302982b9
  worktree-agent-a712ebebe2fa7fc0b
  worktree-agent-ace974456560e04ec
)
kept_branch=t3code/review-pr-1518-1
excluded_names='persona|shared-case|shared_case|sharedcase|multi-user|multiuser'

go=0
nogo=0
pass() {
  go=$((go + 1))
  printf 'GO     %s: %s\n' "$1" "$2"
}
fail() {
  nogo=$((nogo + 1))
  printf 'NO-GO  %s: %s\n' "$1" "$2"
}
note() { printf '       %s\n' "$1"; }
get() { gh api --method GET "$@"; }

# check <name> <expected> <gh api args...>: GO when the read equals the expected value.
check() {
  local name=$1 expected=$2 actual
  shift 2
  if ! actual=$(get "$@"); then
    fail "$name" 'read failed'
  elif [[ $actual == "$expected" ]]; then
    pass "$name" "$actual"
  else
    fail "$name" "expected [$expected], read [$actual]"
  fi
}

check_workflows() {
  local rows active total
  if ! rows=$(get "repos/$repo/actions/workflows?per_page=100" --paginate \
    --jq '.workflows[] | "\(.state)\t\(.name)\t\(.path)"'); then
    fail 'freeze list' 'workflow read failed'
    return
  fi
  total=$(grep -c . <<<"$rows" || true)
  active=$(grep -c $'^active\t' <<<"$rows" || true)
  if ((total == 0)); then
    fail 'freeze list' 'no registered workflows read'
    return
  fi
  while IFS= read -r row; do note "$row"; done <<<"$rows"
  pass 'freeze list' "$total registered; the freeze disables the $active active ones"
}

check_branches() {
  local heads open b sha
  if ! heads=$(git ls-remote --heads "$remote"); then
    fail 'branches' 'ls-remote failed'
    return
  fi
  if ! open=$(get "repos/$repo/pulls?state=open&per_page=100" --paginate \
    --jq '.[] | "\(.head.sha) \(.head.ref)"'); then
    fail 'branches' 'open pull request read failed'
    return
  fi
  for b in "${delete_branches[@]}"; do
    sha=$(awk -v r="refs/heads/$b" '$2 == r { print $1 }' <<<"$heads")
    if [[ -z $sha ]]; then
      fail "delete $b" 'not on origin, so the list no longer matches the ruling'
    elif awk -v r="$b" '$2 == r { f = 1 } END { exit !f }' <<<"$open"; then
      fail "delete $b" 'an open pull request uses it as its head'
    elif awk -v s="$sha" '$1 == s { f = 1 } END { exit !f }' <<<"$open"; then
      fail "delete $b" 'its tip is the head commit of an open pull request'
    elif grep -Eiq "$excluded_names" <<<"$b"; then
      fail "delete $b" 'the name marks Shared Case or persona work'
    else
      pass "delete $b" "on origin at ${sha:0:8}, no open pull request"
    fi
  done
  if grep -q "refs/heads/$kept_branch\$" <<<"$heads"; then
    pass "keep $kept_branch" 'on origin and absent from the deletion list'
  else
    fail "keep $kept_branch" 'not on origin'
  fi
  note "open pull requests: $(grep -c . <<<"$open" || true)"
}

check_bundle() {
  local ls mirror restored remote_count
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  if ! ls=$(git ls-remote "$remote"); then
    fail 'bundle' 'ls-remote failed'
    return
  fi
  remote_count=$(awk '$2 != "HEAD" && $2 !~ /\^\{\}$/' <<<"$ls" | grep -c . || true)
  if ! git clone --mirror --quiet "$remote" "$work/mirror.git" ||
    ! git -C "$work/mirror.git" bundle create --quiet "$work/all.bundle" --all ||
    ! git -C "$work/mirror.git" bundle verify --quiet "$work/all.bundle" 2>/dev/null ||
    ! git clone --mirror --quiet "$work/all.bundle" "$work/restore.git" ||
    ! git -C "$work/restore.git" fsck --no-progress --no-dangling; then
    fail 'bundle' 'mirror, bundle, verify, restore or fsck failed'
    return
  fi
  mirror=$(git -C "$work/mirror.git" for-each-ref --format='%(objectname) %(refname)')
  restored=$(git -C "$work/restore.git" for-each-ref --format='%(objectname) %(refname)')
  note "mirror refs: $(grep -c ' refs/heads/' <<<"$mirror" || true) heads, $(
    grep -c ' refs/pull/' <<<"$mirror" || true
  ) pull, $(grep -c ' refs/tags/' <<<"$mirror" || true) tags"
  note "bundle bytes: $(wc -c <"$work/all.bundle" | tr -d ' ')"
  if [[ $mirror != "$restored" ]]; then
    fail 'bundle' 'the restored refs differ from the mirror'
  elif (($(grep -c . <<<"$mirror") != remote_count)); then
    fail 'bundle' "mirror holds $(grep -c . <<<"$mirror") refs, the remote lists $remote_count"
  else
    pass 'bundle' "$remote_count refs bundled, verified, restored identically, fsck clean"
  fi
}

echo "Cutover dry run for $repo, $(date -u +%Y-%m-%dT%H:%M:%SZ). Read-only."

check 'visibility' 'private' "repos/$repo" --jq '.visibility'
check_workflows
check_branches

# The main ruleset as hardened and read back on 2026-09-28 (#1372, ADR-0008's 2026-09-28
# amendment), normalised to one line.
main_rules='active; ~DEFAULT_BRANCH; RepositoryRole/5/pull_request; '
main_rules+='creation,deletion,non_fast_forward,pull_request,required_signatures,'
main_rules+='required_status_checks; '
main_rules+='Registry publish guard,Secret scan (full history),build,e2e,lint,test,typecheck; '
main_rules+='approvals=1 code_owner=true last_push=true dismiss_stale=true '
main_rules+='thread_resolution=false merge=squash'
check 'main ruleset' "$main_rules" "repos/$repo/rulesets/14967088" --jq '[
    .enforcement,
    (.conditions.ref_name.include | join(",")),
    ([.bypass_actors[] | "\(.actor_type)/\(.actor_id)/\(.bypass_mode)"] | sort | join(",")),
    ([.rules[].type] | sort | join(",")),
    ([.rules[] | select(.type == "required_status_checks")
      | .parameters.required_status_checks[].context] | sort | join(",")),
    (.rules[] | select(.type == "pull_request") | .parameters
      | "approvals=\(.required_approving_review_count) code_owner=\(.require_code_owner_review)"
        + " last_push=\(.require_last_push_approval)"
        + " dismiss_stale=\(.dismiss_stale_reviews_on_push)"
        + " thread_resolution=\(.required_review_thread_resolution)"
        + " merge=\(.allowed_merge_methods | join(","))")
  ] | join("; ")'
check 'tag ruleset' \
  'active; refs/tags/v*; RepositoryRole/5/always; creation,deletion,non_fast_forward,update' \
  "repos/$repo/rulesets/24098840" --jq '[
    .enforcement,
    (.conditions.ref_name.include | join(",")),
    ([.bypass_actors[] | "\(.actor_type)/\(.actor_id)/\(.bypass_mode)"] | sort | join(",")),
    ([.rules[].type] | sort | join(","))
  ] | join("; ")'

check 'actions policy' 'enabled=true allowed_actions=all' "repos/$repo/actions/permissions" \
  --jq '"enabled=\(.enabled) allowed_actions=\(.allowed_actions)"'
check 'workflow token' 'default=read can_approve=false' \
  "repos/$repo/actions/permissions/workflow" \
  --jq '"default=\(.default_workflow_permissions) can_approve=\(.can_approve_pull_request_reviews)"'
check 'fork pull requests' 'write_tokens=false secrets=false' \
  "repos/$repo/actions/permissions/fork-pr-workflows-private-repos" \
  --jq '"write_tokens=\(.send_write_tokens_to_workflows) secrets=\(.send_secrets_and_variables)"'
check 'repository secrets' '0' "repos/$repo/actions/secrets" --jq '.total_count'
check 'doc-curator variable' '0' "repos/$repo/actions/variables?per_page=100" \
  --jq '[.variables[] | select(.name == "DOC_CURATOR_LAST_SHA")] | length'
check 'copilot firewall' 'true' \
  "repos/$repo/actions/variables/COPILOT_AGENT_FIREWALL_ENABLED" --jq '.value'

check_bundle

echo "Summary: $go GO, $nogo NO-GO."
if ((nogo > 0)); then
  echo 'NO-GO: resolve every NO-GO line before the window.'
  exit 1
fi
echo 'GO: every read-only check passed. The final go remains the maintainer'"'"'s approval.'
