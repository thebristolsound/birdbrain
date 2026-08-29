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
for f in "$fx"/fail-*.md; do
  "$check" "$f" >/dev/null 2>&1; expect 1 $? "direct $(basename "$f")"
done

# The 1117 body must fail on the cap and the section rule specifically.
out="$(node "$here/lint-body.mjs" "$fx/fail-1117-walkthrough.md")"
printf '%s' "$out" | grep -q 'lines above ## Verification' && echo "ok   1117 trips the 40-line cap" || { echo "FAIL 1117 cap"; fails=$((fails + 1)); }
printf '%s' "$out" | grep -q 'sections must be exactly' && echo "ok   1117 trips the section rule" || { echo "FAIL 1117 sections"; fails=$((fails + 1)); }

expect 0 "$(hook "gh pr view 12")" "hook ignores a read"
expect 0 "$(hook "gh pr edit 12 --add-label agent-authored")" "hook allows an edit with no body"
expect 0 "$(hook "gh pr create --draft --base main --title 't' --body-file pass-filled.md --label agent-authored")" "hook allows a passing body file"
expect 0 "$(hook "agh pr create --draft --body-file=pass-filled.md")" "hook allows agh with --body-file="
expect 2 "$(hook "gh pr create --draft --body-file fail-1117-walkthrough.md")" "hook blocks a failing body file"
expect 2 "$(hook "gh pr create --draft --title t --body 'inline'")" "hook blocks --body"
expect 2 "$(hook "gh pr edit 12 -b 'inline'")" "hook blocks -b"
expect 0 "$(hook "gh api repos/o/r/pulls/12 --jq .draft")" "hook ignores a pulls read"
expect 0 "$(hook "gh api repos/o/r/pulls -X POST --input pass-filled.json")" "hook allows a passing api payload"
expect 2 "$(hook "gh api repos/o/r/pulls -X POST --input fail-payload.json")" "hook blocks a failing api payload"
expect 0 "$(hook "gh pr create --draft --title t --body 'inline'" "")" "hook passes through an interactive session"
expect 0 "$(hook "gh pr create --draft --title t --body 'inline'" "birdbrain-reviewer")" "hook passes through an unbound agent"

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
