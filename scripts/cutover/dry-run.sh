#!/usr/bin/env bash
# Read-only rehearsal of the public cutover runbook
# (docs/plans/2026-09-28-public-cutover-runbook.md). It makes every check the runbook can make
# without changing anything, prints GO or NO-GO per check, and exits 1 when any check is NO-GO.
#
# Every GitHub read goes through get(), which is `gh api --method GET`. git only reads the remote
# (clone --mirror) and writes into a temporary directory removed on exit. There is no push, no
# workflow disable and no visibility change; tests/cutoverDryRun.test.ts pins that.
#
# Usage: scripts/cutover/dry-run.sh <pinned-refs-file>
#   <pinned-refs-file>  "<sha> <refname>" lines recording each ruled branch's tip when the
#                       custody bundle was built; the runbook names the file. The tips stay in
#                       custody rather than in the repository, beside the bundle that holds them.
# Env:   CUTOVER_REPO    owner/name, default thebristolsound/birdbrain
#        CUTOVER_REMOTE  git URL to mirror, default the repository's https URL
set -euo pipefail

repo=${CUTOVER_REPO:-thebristolsound/birdbrain}
remote=${CUTOVER_REMOTE:-https://github.com/$repo.git}
pinned_file=${1:-}

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
# Shared Case (multi-user) and persona work, matched case-blind against branch names, the paths
# a branch changes and its commit subjects. On main it matches src/main/services/persona/,
# src/main/services/db/{personaRepo,caseMemberRepo}.ts, src/shared/verify/sharedCase.ts,
# src/renderer/**/[Pp]ersonas*, their tests, docs/design-handoff/*shared-case-members/, the
# shared-case and persona plans and specs, and ADR-0030; in subjects, the persona and
# shared-case scopes and the words "Shared Case".
excluded='persona|shared[-_ ]?case|case[-_ ]?member|multi[-_ ]?user|iroh'

# Every Actions variable name, repository level and per environment, as read back on
# 2026-09-28. Every value becomes public at the flip, so an addition is a NO-GO.
expected_variables='repo:BIRDBRAIN_AGENT_GH_LOGIN,repo:BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES,'
expected_variables+='repo:COPILOT_AGENT_FIREWALL_ALLOW_LIST_ADDITIONS,'
expected_variables+='repo:COPILOT_AGENT_FIREWALL_ENABLED'

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

# One fresh mirror of every ref, used for the branch content checks and the bundle.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mirror_ok=0
make_mirror() {
  if git clone --mirror --quiet "$remote" "$work/mirror.git"; then
    mirror_ok=1
  else
    fail 'mirror' "clone --mirror of $remote failed"
  fi
}
mgit() { git -C "$work/mirror.git" "$@"; }

# Prints what marks a branch as Shared Case or persona work, or nothing: its name, the paths it
# changes against its merge base with main, or the subjects of the commits main lacks.
excluded_work() {
  local b=$1 tip=$2 base changed log paths subjects
  if grep -Eiq "$excluded" <<<"$b"; then
    echo 'its name'
    return
  fi
  # No merge base means unrelated history: every path and commit on the branch is its own.
  if base=$(mgit merge-base refs/heads/main "$tip"); then
    changed=$(mgit diff --name-only "$base" "$tip") && log=$(mgit log --format=%s "$base..$tip")
  else
    changed=$(mgit ls-tree -r --name-only "$tip") && log=$(mgit log --format=%s "$tip")
  fi || {
    echo 'an unreadable history (fails closed)'
    return
  }
  paths=$(grep -Ei "$excluded" <<<"$changed" || true)
  subjects=$(grep -Ei "$excluded" <<<"$log" || true)
  if [[ -n $paths ]]; then
    echo "$(grep -c . <<<"$paths") changed paths, first $(head -n 1 <<<"$paths")"
  elif [[ -n $subjects ]]; then
    echo "$(grep -c . <<<"$subjects") commit subjects, first \"$(head -n 1 <<<"$subjects")\""
  fi
}

check_branches() {
  local open heads b tip pinned marked
  if ((!mirror_ok)); then
    fail 'branches' 'no mirror to inspect'
    return
  fi
  if ! open=$(get "repos/$repo/pulls?state=open&per_page=100" --paginate \
    --jq '.[] | "\(.head.sha) \(.head.ref)"'); then
    fail 'branches' 'open pull request read failed'
    return
  fi
  if [[ -z $pinned_file || ! -r $pinned_file ]]; then
    fail 'pinned tips' "no readable pinned-refs file given (read [${pinned_file:-none}])"
  fi
  heads=$(mgit for-each-ref --format='%(objectname) %(refname:strip=2)' refs/heads)
  for b in "${delete_branches[@]}"; do
    tip=$(awk -v r="$b" '$2 == r { print $1 }' <<<"$heads")
    pinned=''
    if [[ -r $pinned_file ]]; then
      pinned=$(awk -v r="refs/heads/$b" '$2 == r { print $1 }' "$pinned_file")
    fi
    if [[ -z $tip ]]; then
      fail "delete $b" 'not on origin, so the list no longer matches the ruling'
    elif [[ -z $pinned ]]; then
      fail "delete $b" "at ${tip:0:8}, with no pinned tip to compare"
    elif [[ $tip != "$pinned" ]]; then
      fail "delete $b" "tip moved from ${pinned:0:8} to ${tip:0:8}; the custody bundle lacks it"
    elif awk -v r="$b" '$2 == r { f = 1 } END { exit !f }' <<<"$open"; then
      fail "delete $b" 'an open pull request uses it as its head'
    elif awk -v s="$tip" '$1 == s { f = 1 } END { exit !f }' <<<"$open"; then
      fail "delete $b" 'its tip is the head commit of an open pull request'
    elif marked=$(excluded_work "$b" "$tip") && [[ -n $marked ]]; then
      fail "delete $b" "Shared Case or persona work by $marked"
    else
      pass "delete $b" "pinned tip ${tip:0:8}, no open pull request, no Shared Case or persona work"
    fi
  done

  tip=$(awk -v r="$kept_branch" '$2 == r { print $1 }' <<<"$heads")
  if [[ -z $tip ]]; then
    fail "keep $kept_branch" 'not on origin'
  elif printf '%s\n' "${delete_branches[@]}" | grep -qxF "$kept_branch"; then
    fail "keep $kept_branch" 'it is in the deletion list'
  else
    pass "keep $kept_branch" "on origin at ${tip:0:8}, not in the deletion list"
    marked=$(excluded_work "$kept_branch" "$tip")
    note "the Shared Case and persona test on the kept branch finds: ${marked:-nothing}"
  fi
  note "open pull requests: $(grep -c . <<<"$open" || true)"
  marked=$(awk '{ print $2 }' <<<"$heads" | grep -Ei "$excluded" | paste -sd ' ' - || true)
  note "heads named like Shared Case or persona work, re-check by hand: ${marked:-none}"
}

check_variables() {
  local actual envs env
  if ! actual=$(get "repos/$repo/actions/variables?per_page=100" --paginate \
    --jq '.variables[] | "repo:\(.name)"') ||
    ! envs=$(get "repos/$repo/environments?per_page=100" --jq '.environments[].name'); then
    fail 'variables' 'read failed'
    return
  fi
  while IFS= read -r env; do
    [[ -z $env ]] && continue
    if ! actual+=$'\n'$(get "repos/$repo/environments/$env/variables?per_page=100" --paginate \
      --jq ".variables[] | \"env/$env:\(.name)\""); then
      fail 'variables' "read of environment $env failed"
      return
    fi
  done <<<"$envs"
  actual=$(grep . <<<"$actual" | sort | paste -sd , - || true)
  if [[ $actual == "$expected_variables" ]]; then
    pass 'variables' "$actual; environments $(paste -sd , - <<<"$envs") hold none"
  else
    fail 'variables' "expected [$expected_variables], read [$actual]"
  fi
}

check_bundle() {
  local ls mirror restored remote_count
  if ((!mirror_ok)); then
    fail 'bundle' 'no mirror to bundle'
    return
  fi
  if ! ls=$(git ls-remote "$remote"); then
    fail 'bundle' 'ls-remote failed'
    return
  fi
  remote_count=$(awk '$2 != "HEAD" && $2 !~ /\^\{\}$/' <<<"$ls" | grep -c . || true)
  if ! mgit bundle create --quiet "$work/all.bundle" --all ||
    ! mgit bundle verify --quiet "$work/all.bundle" 2>/dev/null ||
    ! git clone --mirror --quiet "$work/all.bundle" "$work/restore.git" ||
    ! git -C "$work/restore.git" fsck --no-progress --no-dangling; then
    fail 'bundle' 'bundle, verify, restore or fsck failed'
    return
  fi
  mirror=$(mgit for-each-ref --format='%(objectname) %(refname)')
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
make_mirror
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
check_variables
check 'copilot firewall' 'true' \
  "repos/$repo/actions/variables/COPILOT_AGENT_FIREWALL_ENABLED" --jq '.value'

check_bundle

echo "Summary: $go GO, $nogo NO-GO."
if ((nogo > 0)); then
  echo 'NO-GO: resolve every NO-GO line before the window.'
  exit 1
fi
echo 'GO: every read-only check passed. The final go remains the maintainer'"'"'s approval.'
