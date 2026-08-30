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
  # $1 command, $2 agent_type (default: the bound agent; "" for an interactive session)
  node -e 'const a=process.argv[3]; process.stdout.write(JSON.stringify({tool_name:"Bash",cwd:process.argv[1],...(a?{agent_type:a}:{}),tool_input:{command:process.argv[2]}}))' "$fx" "$1" "${2-birdbrain-implementer}" \
    | "$check" >/dev/null 2>&1
  echo $?
}

for f in "$fx"/pass-*.md "$fx"/pass-*.json; do
  [ -e "$f" ] || continue
  "$check" "$f" >/dev/null 2>&1; expect 0 $? "direct $(basename "$f")"
done
for f in "$fx"/fail-*.md "$fx"/fail-*.json; do
  [ -e "$f" ] || continue
  "$check" "$f" >/dev/null 2>&1; expect 1 $? "direct $(basename "$f")"
done

expect 0 "$(hook "gh issue view 12 --comments")" "hook ignores a read"
expect 0 "$(hook "gh api repos/o/r/issues/12/comments --paginate")" "hook ignores a comments read"
expect 0 "$(hook "agh issue comment 12 --body-file pass-claim.md")" "hook allows a passing claim"
expect 2 "$(hook "gh pr comment 12 --body-file fail-verdict-21-lines.md")" "hook blocks a failing verdict"
expect 2 "$(hook "gh issue comment 12 --body 'inline'")" "hook blocks --body"
expect 2 "$(hook "gh issue comment 12")" "hook blocks a comment with no file"
expect 0 "$(hook "gh api repos/o/r/issues/12/comments -X POST --input pass-reply.json")" "hook allows a passing api payload"
expect 0 "$(hook "gh api repos/o/r/pulls/12/comments/99/replies -X POST --input pass-reply.json")" "hook allows a passing reply payload"
expect 2 "$(hook "gh api repos/o/r/issues/12/comments -X POST --input fail-reply.json")" "hook blocks a failing api payload"
expect 0 "$(hook "gh issue comment 12 --body 'inline'" "")" "hook passes through an interactive session"
expect 0 "$(hook "gh issue comment 12 --body 'inline'" "birdbrain-reviewer")" "hook passes through an unbound agent"

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
