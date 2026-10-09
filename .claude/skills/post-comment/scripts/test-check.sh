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

hint() {
  # $1 fixture, $2 text the rejection must contain (the accepted alternative)
  if "$check" "$fx/$1" 2>&1 | grep -qF -- "$2"; then
    echo "ok   hint $1"
  else
    echo "FAIL hint $1 (missing: $2)"
    fails=$((fails + 1))
  fi
}

hint fail-first-line-commit.md 'say "the latest commit"'
hint fail-first-line-commit.md '"Applied."'
hint fail-first-line-prepass.md 'write "review"'
hint fail-first-line-prepass.md '"**Review verdict: request changes**"'
hint fail-generic-jargon.md 'describe the code in words'
hint fail-details-unclosed.md 'add </details>'
hint fail-defect-no-where.md 'add a line starting "**Where:**"'

expect 0 "$(hook "gh issue view 12 --comments")" "hook ignores a read"
expect 0 "$(hook "gh api repos/o/r/issues/12/comments --paginate")" "hook ignores a comments read"
expect 0 "$(hook "agh issue comment 12 --body-file pass-claim.md")" "hook allows a passing claim"
expect 2 "$(hook "gh pr comment 12 --body-file fail-verdict-top-overflow.md")" "hook blocks a failing verdict"
expect 2 "$(hook "gh issue comment 12 --body 'inline'")" "hook blocks --body"
expect 2 "$(hook "gh issue comment 12")" "hook blocks a comment with no file"
expect 0 "$(hook "gh api repos/o/r/issues/12/comments -X POST --input pass-reply.json")" "hook allows a passing api payload"
expect 0 "$(hook "gh api repos/o/r/pulls/12/comments/99/replies -X POST --input pass-reply.json")" "hook allows a passing reply payload"
expect 2 "$(hook "gh api repos/o/r/issues/12/comments -X POST --input fail-reply.json")" "hook blocks a failing api payload"
expect 0 "$(hook "gh issue comment 12 --body 'inline'" "")" "hook passes through an interactive session"
expect 0 "$(hook "gh issue comment 12 --body 'inline'" "birdbrain-reviewer")" "hook passes through an unbound agent"
expect 2 "$(BIRDBRAIN_DISPATCH=1 hook "gh issue comment 12 --body 'inline'" "")" "hook binds a headless dispatch session"
expect 2 "$(BIRDBRAIN_DISPATCH=1 hook "gh issue comment 12 --body-file /nonexistent/claim.md" "")" "hook blocks a dispatch comment whose file does not exist yet"

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
