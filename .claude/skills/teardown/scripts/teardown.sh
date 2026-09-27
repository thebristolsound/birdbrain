#!/usr/bin/env bash
# Close one worktree, or sweep every worktree and local branch, by the lanes in SKILL.md.
#   teardown.sh close [<path>] [--branch <ref>] [--merged <sha>] [--artefacts] [--t3code]
#   teardown.sh sweep [--apply] [--older-than <days>] [--t3code] [--count]
# Every deletion is gated here, because the git guardrail hook cannot see inside a script:
# `branch -D` only when the tip is a merged PR head, `rm -rf` only on paths git ignores and
# tracks nothing under, `worktree remove` never with --force, unlock only on a dead pid.
# Exit: 0 done (or dry run), 1 refused or failed, 2 usage.
set -u

cmd="${1:-}"; [ $# -gt 0 ] && shift
target="" branch="" merged="" artefacts=0 t3=0 apply=0 older="" count=0
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) branch="${2:-}"; shift 2 ;;
    --merged) merged="${2:-}"; shift 2 ;;
    --artefacts) artefacts=1; shift ;;
    --t3code) t3=1; shift ;;
    --apply) apply=1; shift ;;
    --older-than) older="${2:-}"; shift 2 ;;
    --count) count=1; shift ;;
    -*) echo "teardown: unknown flag $1" >&2; exit 2 ;;
    *) target="$1"; shift ;;
  esac
done
case "$cmd" in close|sweep) ;; *)
  echo "usage: teardown.sh close [<path>] [--branch <ref>] [--merged <sha>] [--artefacts] [--t3code]" >&2
  echo "       teardown.sh sweep [--apply] [--older-than <days>] [--t3code] [--count]" >&2
  exit 2 ;;
esac
[ -z "$older" ] || [[ "$older" =~ ^[0-9]+$ ]] || { echo "teardown: --older-than takes a number of days" >&2; exit 2; }

# The tree roots are variables so the tests can place fixture trees without touching real ones.
t3_root="${TEARDOWN_T3_ROOT:-$HOME/.t3/worktrees}"
tmp_root="${TEARDOWN_TMP_ROOT:-/tmp}"
artefact_paths=".preflight .health coverage test-results playwright-report out dist extension/dist .serena/cache"

say() { [ "$count" -eq 1 ] || echo "teardown: $*"; }
fail() { echo "teardown: refused: $*" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$PWD"; git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || repo="$here"
main_wt="$(git -C "$repo" worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')"
[ -n "$main_wt" ] || fail "not inside a git repository"
caller="$(pwd -P)"
own_pid=""; [ "$cmd" = close ] && own_pid="${CLAUDE_PID:-}"

# One record per registered tree: path, head, branch, lock reason, prunable. "-" marks an empty
# field, because tab is IFS whitespace and `read` would collapse two tabs into one.
trees() {
  git -C "$main_wt" worktree list --porcelain | awk '
    function flush() { if (p != "") printf "%s\t%s\t%s\t%s\t%s\n", p, h, b, l, pr; p = ""; h = "-"; b = "-"; l = "-"; pr = "-" }
    BEGIN { h = "-"; b = "-"; l = "-"; pr = "-" }
    /^worktree / { flush(); p = substr($0, 10) }
    /^HEAD / { h = $2 }
    /^branch / { b = substr($2, 12) }
    /^locked/ { l = (length($0) > 7) ? substr($0, 8) : "(no reason)" }
    /^prunable/ { pr = "yes" }
    END { flush() }'
}

# PR state by head branch. A branch with several PRs reads as open if any is open, else by its
# latest PR; every merged head sha is kept, because a tip equal to any of them was merged.
declare -A pr_state pr_num pr_shas
load_prs() {
  local json rows head state num shas
  json="$(cd "$main_wt" && gh pr list --state all --limit 5000 ${1:+--head "$1"} \
    --json number,state,headRefName,headRefOid,isCrossRepository)" || return 1
  rows="$(printf '%s' "$json" | node -e '
    const prs = JSON.parse(require("fs").readFileSync(0, "utf8")).filter(p => !p.isCrossRepository)
    const by = {}
    for (const p of prs) (by[p.headRefName] ??= []).push(p)
    for (const [head, list] of Object.entries(by)) {
      list.sort((a, b) => b.number - a.number)
      const pick = list.find(p => p.state === "OPEN") ?? list[0]
      const shas = list.filter(p => p.state === "MERGED").map(p => p.headRefOid).join(",") || "-"
      console.log([head, pick.state, pick.number, shas].join("\t"))
    }')" || return 1
  while IFS=$'\t' read -r head state num shas; do
    [ -n "$head" ] || continue
    pr_state[$head]="$state"; pr_num[$head]="$num"; pr_shas[$head]="$shas"
  done <<<"$rows"
}

# clean | serena | dirty <n> | unreadable. "serena" is a diff confined to .serena/project.yml:
# Serena rewrites that file's comments and default keys on activation, and nothing authored
# lives there (Serena left the repo on 2026-09-25; older branches still track the file).
tree_state() {
  local st
  st="$(git -C "$1" status --porcelain 2>/dev/null)" || { echo unreadable; return; }
  if [ -z "$st" ]; then echo clean; return; fi
  if [ "$st" = " M .serena/project.yml" ]; then echo serena; return; fi
  echo "dirty $(printf '%s\n' "$st" | wc -l | tr -d ' ')"
}

lock_pid() { [[ "$1" =~ pid[=\ ]([0-9]+) ]] && echo "${BASH_REMATCH[1]}"; }
pid_alive() { ps -p "$1" >/dev/null 2>&1; }

# Days since the tree last moved: the later of its HEAD commit and its HEAD reflog.
age_days() {
  local path="$1" head="$2" ct gd rt now
  ct="$(git -C "$main_wt" log -1 --format=%ct "$head" 2>/dev/null || echo 0)"
  rt=0
  if [ -n "$path" ] && gd="$(git -C "$path" rev-parse --absolute-git-dir 2>/dev/null)" && [ -f "$gd/logs/HEAD" ]; then
    rt="$(stat -c %Y "$gd/logs/HEAD" 2>/dev/null || stat -f %m "$gd/logs/HEAD" 2>/dev/null || echo 0)"
  fi
  [ "$rt" -gt "$ct" ] && ct="$rt"
  now="$(date +%s)"
  echo $(( (now - ct) / 86400 ))
}

under() { case "$1/" in "$2"/*) return 0 ;; *) return 1 ;; esac; }
tip_merged() { case ",$2," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# Echoes "<apply|report> <lane> <detail>" for one tree. Apply lanes are the only ones any
# caller acts on; report lanes are listed and left, and no flag turns one into the other.
classify_tree() {
  local path="$1" head="$2" br="$3" lock="$4" prunable="$5" pid state
  if [ "$path" = "$main_wt" ]; then echo "report main-checkout -"; return; fi
  case "$path" in /*) ;; *) echo "report mangled-path -"; return ;; esac
  case "$path" in *\\*) echo "report mangled-path -"; return ;; esac
  if [ "$prunable" = yes ] || [ ! -d "$path" ]; then echo "apply gone -"; return; fi
  if [ "$lock" != "-" ]; then
    pid="$(lock_pid "$lock")"
    if [ -z "$pid" ]; then echo "report locked no-pid-in-reason"; return; fi
    # close may lift a lock its own session placed (SKILL.md, creating a scratch tree); sweep never does.
    if pid_alive "$pid" && [ "$pid" != "$own_pid" ]; then echo "report locked pid-$pid-alive"; return; fi
  fi
  if under "$caller" "$path"; then echo "report in-use this-shell-is-inside-it"; return; fi
  state="$(tree_state "$path")"
  case "$state" in clean|serena) ;; *) echo "report ${state%% *} ${state#* }"; return ;; esac
  if [ "$br" = "-" ]; then
    if under "$path" "$tmp_root" && [ -n "$(git -C "$main_wt" for-each-ref --count=1 --contains "$head" refs/heads refs/remotes)" ]; then
      echo "apply detached-tmp -"
    else
      echo "report detached -"
    fi
    return
  fi
  case "${pr_state[$br]:-}" in
    OPEN) echo "report open-pr #${pr_num[$br]}" ;;
    MERGED) echo "apply merged #${pr_num[$br]}" ;;
    CLOSED) echo "apply closed #${pr_num[$br]}" ;;
    *) echo "report no-pr -" ;;
  esac
}

classify_branch() {
  local br="$1" tip
  tip="$(git -C "$main_wt" rev-parse "refs/heads/$br")"
  case "${pr_state[$br]:-}" in
    OPEN) echo "report open-pr #${pr_num[$br]}" ;;
    CLOSED) echo "report closed #${pr_num[$br]}" ;;
    MERGED)
      if tip_merged "$tip" "${pr_shas[$br]}"; then echo "apply merged #${pr_num[$br]}"
      else echo "report merged-tip-moved #${pr_num[$br]}@${tip:0:12}"; fi ;;
    *) echo "report no-pr -" ;;
  esac
}

remove_tree() {
  local path="$1" lock="$2"
  if [ "$(tree_state "$path")" = serena ]; then
    git -C "$path" checkout -q -- .serena/project.yml || return 1
  fi
  if [ "$lock" != "-" ]; then git -C "$main_wt" worktree unlock "$path" || return 1; fi
  git -C "$main_wt" worktree remove "$path"
}

delete_branch() {
  local br="$1" shas="$2" tip
  case "$br" in main|master) say "kept branch $br"; return ;; esac
  git -C "$main_wt" show-ref --verify --quiet "refs/heads/$br" || return 0
  tip="$(git -C "$main_wt" rev-parse "refs/heads/$br")"
  if tip_merged "$tip" "$shas"; then
    git -C "$main_wt" branch -D "$br" >/dev/null && say "deleted branch $br" || say "WARN could not delete branch $br"
  elif git -C "$main_wt" branch -d "$br" >/dev/null 2>&1; then
    say "deleted branch $br (merged by ancestry)"
  else
    say "kept branch $br: tip ${tip:0:12} is not a merged PR head"
  fi
}

clean_artefacts() {
  local path="$1" a
  for a in $artefact_paths; do
    [ -e "$path/$a" ] || continue
    git -C "$path" check-ignore -q "$a" || { say "kept $a: not ignored in $path"; continue; }
    [ -z "$(git -C "$path" ls-files -- "$a" | head -1)" ] || { say "kept $a: git tracks files under it in $path"; continue; }
    rm -rf "${path:?}/$a" && say "removed $path/$a"
  done
}

if [ "$cmd" = close ]; then
  holders=()
  if [ -n "$branch" ]; then
    while IFS=$'\t' read -r p _ b _ _; do [ "$b" = "$branch" ] && holders+=("$p"); done < <(trees)
    if [ ${#holders[@]} -eq 0 ]; then say "no worktree holds $branch"; exit 0; fi
  else
    holders+=("$(cd "${target:-.}" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)")
    [ -n "${holders[0]}" ] || fail "${target:-.} is not inside a worktree"
  fi
  rc=0
  for want in "${holders[@]}"; do
    rec="$(trees | awk -F'\t' -v p="$want" '$1==p')"
    [ -n "$rec" ] || fail "$want is not a registered worktree"
    IFS=$'\t' read -r path head br lock prunable <<<"$rec"
    [ "$path" != "$main_wt" ] || fail "$path is the main checkout"
    if under "$path" "$t3_root" && [ "$t3" -eq 0 ]; then
      say "refused $path: a t3code thread tree; pass --t3code to close it"; rc=1; continue
    fi
    clean_artefacts "$path"
    [ "$artefacts" -eq 0 ] || continue
    if [ "$br" != "-" ]; then
      if [ -n "$merged" ]; then pr_state[$br]=MERGED; pr_num[$br]="?"; pr_shas[$br]="$merged"
      else load_prs "$br" || fail "cannot read PR state for $br"; fi
    fi
    read -r action lane detail <<<"$(classify_tree "$path" "$head" "$br" "$lock" "$prunable")"
    if [ "$action" != apply ]; then say "refused $path ($br): $lane $detail"; rc=1; continue; fi
    remove_tree "$path" "$lock" || { say "FAILED to remove $path"; rc=1; continue; }
    say "removed $path ($lane $detail)"
    [ "$lane" = merged ] && delete_branch "$br" "${pr_shas[$br]}"
    [ "$lane" = closed ] && say "kept branch $br: its PR closed unmerged"
  done
  exit "$rc"
fi

# sweep
load_prs || { if [ "$count" -eq 1 ]; then echo "teardown: count skipped, PR state unreadable"; exit 0; fi; fail "cannot read PR state (gh pr list)"; }
declare -A tally
held=" "
apply_n=0 report_n=0 pruned=0 acted=0 failed=0
note() {
  # <action> <lane> <kind> <name> <detail>
  tally["$1 $3 $2"]=$(( ${tally["$1 $3 $2"]:-0} + 1 ))
  [ "$1" = apply ] && apply_n=$((apply_n + 1)) || report_n=$((report_n + 1))
  say "$(printf '%-6s %-7s %-22s %s  %s' "$1" "$3" "$2" "$4" "$5")"
}
gate() {
  # Demotes an apply lane to report under the t3code and age gates; echoes the reason if so.
  local path="$1" head="$2" days
  if [ -n "$path" ] && under "$path" "$t3_root" && [ "$t3" -eq 0 ]; then echo "t3code-tree"; return; fi
  if [ -n "$older" ]; then days="$(age_days "$path" "$head")"; [ "$days" -ge "$older" ] || echo "${days}d-old"; fi
}

while IFS=$'\t' read -r path head br lock prunable; do
  [ "$br" = "-" ] || held="$held$br "
  read -r action lane detail <<<"$(classify_tree "$path" "$head" "$br" "$lock" "$prunable")"
  if [ "$action" = apply ] && [ "$lane" != gone ]; then
    why="$(gate "$path" "$head")"
    [ -z "$why" ] || { action=report; detail="$detail,$why"; }
  fi
  note "$action" "$lane" tree "$path" "$br $detail"
  [ "$apply" -eq 1 ] && [ "$action" = apply ] || continue
  if [ "$lane" = gone ]; then pruned=1; continue; fi
  if remove_tree "$path" "$lock"; then
    acted=$((acted + 1)); say "removed $path"
    [ "$lane" = merged ] && delete_branch "$br" "${pr_shas[$br]}"
  else
    failed=$((failed + 1)); say "FAILED to remove $path"
  fi
done < <(trees)
if [ "$pruned" -eq 1 ]; then git -C "$main_wt" worktree prune && say "pruned registrations whose directory is gone"; fi

while read -r br; do
  case "$held" in *" $br "*) continue ;; esac
  case "$br" in main|master) continue ;; esac
  read -r action lane detail <<<"$(classify_branch "$br")"
  if [ "$action" = apply ]; then
    why="$(gate "" "refs/heads/$br")"
    [ -z "$why" ] || { action=report; detail="$detail,$why"; }
  fi
  note "$action" "$lane" branch "$br" "$detail"
  if [ "$apply" -eq 1 ] && [ "$action" = apply ]; then delete_branch "$br" "${pr_shas[$br]}"; acted=$((acted + 1)); fi
done < <(git -C "$main_wt" for-each-ref --format='%(refname)' refs/heads | sed 's|^refs/heads/||')

stashes="$(git -C "$main_wt" stash list --format='%gd  %cr  %gs')"
if [ -n "$stashes" ]; then
  while read -r s; do note report stash stash "$s" "never touched"; done <<<"$stashes"
fi

if [ "$count" -eq 1 ]; then
  echo "teardown: $apply_n reclaimable (trees and branches in apply lanes), $report_n report-only; list them with .claude/skills/teardown/scripts/teardown.sh sweep"
  exit 0
fi
echo
printf '%-7s %-7s %-22s %s\n' action kind lane count
for k in "${!tally[@]}"; do printf '%s\n' "$k ${tally[$k]}"; done | sort | while read -r a kd l c; do
  printf '%-7s %-7s %-22s %s\n' "$a" "$kd" "$l" "$c"
done
if [ "$apply" -eq 1 ]; then
  say "acted on $acted, failed $failed"
  [ "$failed" -eq 0 ]
else
  say "dry run: nothing removed; re-run with --apply to act on the apply lanes"
fi
