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
  node -e 'process.stdout.write(JSON.stringify({tool_name:"Bash",cwd:process.argv[1],tool_input:{command:process.argv[2]}}))' "$fx" "$1" \
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

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
