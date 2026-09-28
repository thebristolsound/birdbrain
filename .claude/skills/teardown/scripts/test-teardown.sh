#!/usr/bin/env bash
# Builds a throwaway repo with one worktree or branch per lane, shims gh with canned PR state,
# and checks what teardown.sh removes and keeps. Exit 1 on any unexpected result.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
td="$here/teardown.sh"
fx="$(mktemp -d)"
fx="$(cd "$fx" && pwd -P)"
trap 'rm -rf "$fx"' EXIT
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
g() { git -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }

mkdir -p "$fx/bin" "$fx/trees" "$fx/tmp" "$fx/t3/birdbrain"
git init -q --bare -b main "$fx/origin.git"
g clone -q "$fx/origin.git" "$fx/main" 2>/dev/null
m="$fx/main"
printf 'node_modules/\ndist/\n.preflight/\n' > "$m/.gitignore"
mkdir -p "$m/.serena"; printf '# languages:\n#   bash\nproject_name: "x"\n' > "$m/.serena/project.yml"
echo a > "$m/a.txt"
g -C "$m" add .gitignore .serena/project.yml a.txt && g -C "$m" commit -qm init && g -C "$m" push -q origin main

# tree <dir> <branch>: a worktree on a new branch with one commit of its own
tree() {
  g -C "$m" worktree add -q -b "$2" "$1" main 2>/dev/null
  echo "$2" > "$1/$2.txt"; g -C "$1" add "$2.txt"; g -C "$1" commit -qm "$2"
}
sha() { git -C "$m" rev-parse "refs/heads/$1"; }

tree "$fx/trees/merged" merged;           mkdir -p "$fx/trees/merged/node_modules"; echo x > "$fx/trees/merged/node_modules/x"
tree "$fx/trees/moved" moved;             moved_old="$(sha moved)"
echo more > "$fx/trees/moved/more.txt"; g -C "$fx/trees/moved" add more.txt; g -C "$fx/trees/moved" commit -qm more
tree "$fx/trees/closed" closed
tree "$fx/trees/open" open
tree "$fx/trees/nopr" nopr
tree "$fx/trees/dirty" dirty;             echo u > "$fx/trees/dirty/untracked.txt"
tree "$fx/trees/serena" serena;           printf '# languages:\n#   bash  go\nproject_name: "x"\n' > "$fx/trees/serena/.serena/project.yml"
tree "$fx/trees/serena-real" serena-real; printf 'included_apis: []\n' >> "$fx/trees/serena-real/.serena/project.yml"; echo x >> "$fx/trees/serena-real/a.txt"
tree "$fx/trees/live" live;               g -C "$m" worktree lock --reason "claude agent x (pid $$ start 1)" "$fx/trees/live"
sh -c 'exit 0' & dead=$!; wait "$dead"
tree "$fx/trees/deadlock" deadlock;       g -C "$m" worktree lock --reason "birdbrain test pid=$dead created=now" "$fx/trees/deadlock"
tree "$fx/t3/birdbrain/t3tree" t3tree
tree "$fx/trees/artefacts" artefacts
mkdir -p "$fx/trees/artefacts/.preflight" "$fx/trees/artefacts/dist"
echo v > "$fx/trees/artefacts/.preflight/verification.md"
echo t > "$fx/trees/artefacts/dist/tracked.txt"; g -C "$fx/trees/artefacts" add -f dist/tracked.txt; g -C "$fx/trees/artefacts" commit -qm dist
tree "$fx/trees/viamerge" viamerge
tree "$fx/trees/gone" gone;               rm -rf "$fx/trees/gone"
g -C "$m" worktree add -q --detach "$fx/tmp/scratch" main 2>/dev/null
g -C "$m" worktree add -q --detach "$fx/tmp/orphan" main 2>/dev/null
g -C "$m" worktree add -q --detach "$fx/tmp/own" main 2>/dev/null
g -C "$m" worktree lock --reason "birdbrain conflict pid=$$ created=now" "$fx/tmp/own"
echo o > "$fx/tmp/orphan/o.txt"; g -C "$fx/tmp/orphan" add o.txt; g -C "$fx/tmp/orphan" commit -qm orphan
g -C "$m" branch br-merged main; g -C "$m" branch br-moved main; g -C "$m" branch br-nopr main
echo s > "$m/a.txt"; g -C "$m" stash push -q -m teardown-fixture

pr() { printf '{"number":%s,"state":"%s","headRefName":"%s","headRefOid":"%s","isCrossRepository":false}' "$1" "$2" "$3" "$4"; }
{
  echo "["
  pr 1 MERGED merged "$(sha merged)"; echo ","
  pr 2 MERGED moved "$moved_old"; echo ","
  pr 3 CLOSED closed "$(sha closed)"; echo ","
  pr 4 OPEN open "$(sha open)"; echo ","
  pr 5 MERGED dirty "$(sha dirty)"; echo ","
  pr 6 MERGED serena "$(sha serena)"; echo ","
  pr 7 MERGED serena-real "$(sha serena-real)"; echo ","
  pr 8 MERGED live "$(sha live)"; echo ","
  pr 9 MERGED deadlock "$(sha deadlock)"; echo ","
  pr 10 MERGED t3tree "$(sha t3tree)"; echo ","
  pr 11 MERGED br-merged "$(sha br-merged)"; echo ","
  pr 12 MERGED br-moved "$moved_old"; echo ","
  pr 13 CLOSED main "$(sha br-merged)"; echo ","
  pr 14 OPEN nopr "$(sha nopr)" | sed 's/false/true/'
  echo "]"
} > "$fx/prs.json"
printf '#!/bin/sh\n[ "$1 $2" = "pr list" ] || exit 1\ncat "%s"\n' "$fx/prs.json" > "$fx/bin/gh"
chmod +x "$fx/bin/gh"

run() { (cd "$m" && PATH="$fx/bin:$PATH" TEARDOWN_T3_ROOT="$fx/t3" TEARDOWN_TMP_ROOT="$fx/tmp" bash "$td" "$@"); }
has_tree() { git -C "$m" worktree list --porcelain | grep -qx "worktree $1"; }
has_branch() { git -C "$m" show-ref --verify --quiet "refs/heads/$1"; }

# Dry run first: it must change nothing.
before="$(git -C "$m" worktree list --porcelain | grep -c '^worktree')"
out="$(run sweep)"; rc=$?
check "dry run exits 0" '[ "$rc" -eq 0 ]'
check "dry run removes nothing" '[ "$(git -C "$m" worktree list --porcelain | grep -c "^worktree")" -eq "$before" ]'
check "dry run says so" 'printf "%s" "$out" | grep -q "dry run: nothing removed"'
check "stash is listed" 'printf "%s" "$out" | grep -q "teardown-fixture"'
check "a cross-repository PR is ignored (nopr reads as no PR)" 'printf "%s" "$out" | grep -E "tree +no-pr +$fx/trees/nopr" >/dev/null'
check "count prints one line" '[ "$(run sweep --count | wc -l)" -eq 1 ]'
check "--older-than demotes fresh trees" 'run sweep --older-than 30 | grep -E "report +tree +merged +$fx/trees/merged .*0d-old" >/dev/null'

# Close refusals and the artefact pass.
run close "$m" >/dev/null 2>&1; rc=$?
check "close refuses the main checkout" '[ "$rc" -eq 1 ]'
run close "$fx/t3/birdbrain/t3tree" >/dev/null 2>&1; rc=$?
check "close refuses a t3code tree without --t3code" '[ "$rc" -eq 1 ] && has_tree "$fx/t3/birdbrain/t3tree"'
(cd "$fx/trees/merged" && PATH="$fx/bin:$PATH" TEARDOWN_T3_ROOT="$fx/t3" TEARDOWN_TMP_ROOT="$fx/tmp" bash "$td" close) >/dev/null 2>&1; rc=$?
check "close refuses the tree the caller stands in" '[ "$rc" -eq 1 ] && has_tree "$fx/trees/merged"'
run close "$fx/trees/artefacts" --artefacts >/dev/null
check "--artefacts removes an ignored output" '[ ! -e "$fx/trees/artefacts/.preflight" ]'
check "--artefacts keeps an ignored dir that holds a tracked file" '[ -f "$fx/trees/artefacts/dist/tracked.txt" ]'
check "--artefacts keeps the tree" 'has_tree "$fx/trees/artefacts"'
run close "$fx/trees/open" >/dev/null; rc=$?
check "close refuses an open PR" '[ "$rc" -eq 1 ] && has_tree "$fx/trees/open"'
run close --branch viamerge --merged "$(sha viamerge)" >/dev/null; rc=$?
check "close --branch --merged (the merge.sh call) removes tree and branch" '[ "$rc" -eq 0 ] && ! has_tree "$fx/trees/viamerge" && ! has_branch viamerge'
CLAUDE_PID=1 run close "$fx/tmp/own" >/dev/null; rc=$?
check "close refuses another session's live lock" '[ "$rc" -eq 1 ] && has_tree "$fx/tmp/own"'
CLAUDE_PID=$$ run close "$fx/tmp/own" >/dev/null; rc=$?
check "close lifts its own session's lock (the creation rule)" '[ "$rc" -eq 0 ] && ! has_tree "$fx/tmp/own"'
check "close --branch with no holder is a no-op" 'run close --branch nosuch | grep -q "no worktree holds nosuch"'

# Apply.
run sweep --apply >/dev/null; rc=$?
check "apply exits 0" '[ "$rc" -eq 0 ]'
check "merged clean: tree removed (ignored node_modules does not block)" '! has_tree "$fx/trees/merged" && [ ! -d "$fx/trees/merged" ]'
check "merged clean: branch deleted" '! has_branch merged'
check "merged, tip moved: tree removed, branch kept" '! has_tree "$fx/trees/moved" && has_branch moved'
check "closed unmerged: tree removed, branch kept" '! has_tree "$fx/trees/closed" && has_branch closed'
check "open PR: kept" 'has_tree "$fx/trees/open"'
check "no PR: kept" 'has_tree "$fx/trees/nopr" && has_branch nopr'
check "dirty: kept" 'has_tree "$fx/trees/dirty" && [ -f "$fx/trees/dirty/untracked.txt" ]'
check "serena drift alone: removed" '! has_tree "$fx/trees/serena"'
check "serena drift plus another change: kept" 'has_tree "$fx/trees/serena-real"'
check "live lock: kept" 'has_tree "$fx/trees/live"'
check "dead lock: removed" '! has_tree "$fx/trees/deadlock"'
check "t3code tree: kept without --t3code" 'has_tree "$fx/t3/birdbrain/t3tree"'
check "gone directory: pruned" '! has_tree "$fx/trees/gone"'
check "detached scratch under the tmp root: removed" '! has_tree "$fx/tmp/scratch"'
check "detached with an unreachable commit: kept" 'has_tree "$fx/tmp/orphan"'
check "branch, merged at the PR head: deleted" '! has_branch br-merged'
check "branch, merged but tip moved: kept" 'has_branch br-moved'
check "branch, no PR: kept" 'has_branch br-nopr'
check "main: kept despite a PR from it" 'has_branch main'
check "stash untouched" 'git -C "$m" stash list | grep -q teardown-fixture'

run sweep --apply --t3code >/dev/null
check "t3code tree: removed with --t3code" '! has_tree "$fx/t3/birdbrain/t3tree" && ! has_branch t3tree'

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
