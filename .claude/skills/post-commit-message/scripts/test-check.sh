#!/usr/bin/env bash
# Runs the fixtures through check.sh in both modes. Exit 1 on any unexpected result.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="$here/check.sh"
fx="$here/fixtures"
fails=0

expect() {
  local want="$1" got="$2" label="$3"
  if [ "$got" -eq "$want" ]; then
    echo "ok   $label (exit $got)"
  else
    echo "FAIL $label (want $want, got $got)"
    fails=$((fails + 1))
  fi
}

hook() {
  # $1 command; prints the hook's exit code
  # $1 command, $2 agent_type (default: the bound agent; "" for an interactive session)
  node -e 'const a=process.argv[3]; process.stdout.write(JSON.stringify({tool_name:"Bash",cwd:process.argv[1],...(a?{agent_type:a}:{}),tool_input:{command:process.argv[2]}}))' "$fx" "$1" "${2-birdbrain-implementer}" \
    | "$check" >/dev/null 2>&1
  echo $?
}

for f in "$fx"/pass-*.txt; do
  "$check" "$f" >/dev/null 2>&1; expect 0 $? "direct $(basename "$f")"
done
for f in "$fx"/fail-*.txt; do
  "$check" "$f" >/dev/null 2>&1; expect 1 $? "direct $(basename "$f")"
done

expect 0 "$(hook "git status")" "hook ignores non-commit"
expect 0 "$(hook "git commit -q -F pass-body.txt")" "hook allows a passing -F file"
expect 0 "$(hook "git commit --file=pass-body.txt")" "hook allows --file="
expect 2 "$(hook "git commit -F fail-coauthor.txt")" "hook blocks a failing -F file"
expect 2 "$(hook "git add x && git commit -m 'fix(x): y'")" "hook blocks -m"
expect 2 "$(hook "git commit -F - <<'EOF'
fix(x): y
EOF")" "hook blocks a heredoc"
expect 2 "$(hook "git commit")" "hook blocks a commit with no message source"
expect 0 "$(hook "git commit --amend --no-edit")" "hook allows amend with no new message"
expect 2 "$(hook "git commit --amend -m 'fix(x): y'")" "hook blocks amend with -m"
expect 2 "$(hook "git merge main")" "hook blocks a merge that commits"
expect 2 "$(hook "git fetch && git merge -m 'x' origin/main")" "hook blocks a merge with -m"
expect 2 "$(hook "git merge --continue")" "hook blocks merge --continue"
expect 0 "$(hook "git merge --no-commit --no-ff main")" "hook allows merge --no-commit"
expect 0 "$(hook "git merge --ff-only origin/main")" "hook allows a fast-forward merge"
expect 0 "$(hook "git merge --abort")" "hook allows merge --abort"
expect 0 "$(hook "git merge-base HEAD origin/main")" "hook ignores merge-base"
expect 2 "$(hook "git revert abc1234")" "hook blocks a revert that commits"
expect 0 "$(hook "git revert --no-commit abc1234")" "hook allows revert --no-commit"
expect 0 "$(hook "git revert -n abc1234")" "hook allows revert -n"
expect 0 "$(hook "git merge main" "")" "hook passes a merge through an interactive session"
expect 0 "$(hook "git commit -m 'fix(x): y'" "")" "hook passes through an interactive session"
expect 0 "$(hook "git commit -m 'fix(x): y'" "birdbrain-reviewer")" "hook passes through an unbound agent"
expect 2 "$(BIRDBRAIN_DISPATCH=1 hook "git commit -m 'fix(x): y'" "")" "hook binds a headless dispatch session"

# A subagent's worktree arrives as the payload's cwd while CLAUDE_PROJECT_DIR still names the
# parent session's tree, which may have no node_modules.
no_deps="$(mktemp -d)"
expect 0 "$(CLAUDE_PROJECT_DIR="$no_deps" hook "git commit -F pass-body.txt")" \
  "hook lints from the cwd's worktree, not the project directory"
expect 0 "$(node -e 'process.stdout.write(JSON.stringify({tool_name:"Bash",cwd:process.argv[1],agent_type:"birdbrain-implementer",tool_input:{command:process.argv[2]}}))' \
  "$no_deps" "git commit -F $fx/pass-body.txt" \
  | CLAUDE_PROJECT_DIR="$(git -C "$here" rev-parse --show-toplevel)" "$check" >/dev/null 2>&1; echo $?)" \
  "hook falls back to the project directory when cwd is outside a worktree"
rmdir "$no_deps"

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
