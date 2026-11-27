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
"$check" --any-author "$fx/fail-no-attribution.md" >/dev/null 2>&1; expect 0 $? "direct --any-author accepts a body without the attribution line"
"$check" --any-author "$fx/fail-attribution-not-last.md" >/dev/null 2>&1; expect 1 $? "direct --any-author still wants the line last when present"
"$check" --any-author "$fx/fail-footer-authored.md" >/dev/null 2>&1; expect 1 $? "direct --any-author still rejects an authored footer"
"$check" --any-author --posted "$fx/pass-filled.md" >/dev/null 2>&1; expect 0 $? "direct --posted accepts attached screenshots"
posted_fx="$(mktemp -d)"
trap 'rm -rf "$posted_fx"' EXIT
# A real, readable PNG: without --posted it passes, so only the flag can make it fail.
printf '\x89PNG\r\n\x1a\n' > "$posted_fx/after.png"
sed "s#https://github.com/user-attachments/assets/4f5a6b7c-after#$posted_fx/after.png#" "$fx/pass-filled.md" > "$posted_fx/local.md"
"$check" --any-author "$posted_fx/local.md" >/dev/null 2>&1; expect 0 $? "direct check accepts a readable local screenshot"
"$check" --any-author --posted "$posted_fx/local.md" >/dev/null 2>&1; expect 1 $? "direct --posted refuses a readable local screenshot"

# Each fixture for a rule this layout added must fail on that rule, not on another one.
finds() {
  # $1 fixture, $2 expected finding text, $3 extra flags
  local out
  # shellcheck disable=SC2086
  out="$(node "$here/lint-body.mjs" ${3-} "$fx/$1" 2>&1)"
  if printf '%s' "$out" | grep -qF -- "$2"; then echo "ok   $1 raises: $2"; else
    echo "FAIL $1 does not raise: $2"; fails=$((fails + 1)); fi
}
finds fail-merge-risk-missing.md 'goes the Merge risk notice'
finds fail-merge-risk-extra-line.md 'goes the Merge risk notice'
finds fail-merge-risk-colour.md 'takes the [!CAUTION] alert'
finds fail-summary-after-diagram.md 'left out of the merge commit'
finds fail-proof-text-outside.md 'Proof is one <details> block'
finds fail-proof-no-head.md 'Proof names the head commit'
finds fail-proof-stale-head.md 'but Verification ran at'
finds fail-proof-no-table.md 'Proof holds the'
finds fail-proof-empty.md 'Proof has no filled row'
finds fail-proof-second-table.md 'Proof has no filled row'
finds fail-proof-decoy-table.md 'lacks a proof or result'
finds fail-proof-row-unproven.md 'lacks a proof or result'
finds fail-screenshots-missing.md 'sections must be'
finds fail-image-outside-screenshots.md 'images go in the Screenshots section'
finds fail-html-image-outside.md 'images go in the Screenshots section'
finds fail-reference-image-outside.md 'images go in the Screenshots section'
finds fail-shortcut-image-outside.md 'images go in the Screenshots section'
finds fail-extra-screenshot-line.md 'every screenshot is a Before or After row'
finds fail-image-in-screen-name.md 'names its screen with an image'
finds fail-duplicate-screenshot.md 'duplicate after screenshot'
finds fail-img-two-src.md 'exactly one src attribute'
finds fail-img-data-src.md 'upload the screenshot' --posted
finds fail-not-done-empty.md 'Not done is empty'
finds fail-not-done-prose.md 'Not done holds only bullets'
finds fail-blast-radius.md 'Blast radius is two filled bullets'
finds fail-before-merge-empty.md 'Before merge holds one filled'
finds fail-checkbox-shape.md 'Before merge holds one filled'
finds fail-changes-no-file-group.md 'Changes lists no file group'
finds fail-empty-decisions.md 'is an empty table'
finds fail-header-only-decisions.md 'is an empty table'
finds fail-decisions-blank-row.md 'is an empty table'
finds fail-section-order.md 'sections must be'
finds fail-screenshots-in-fence.md 'no before/after screenshot pair'

# The 1117 body must fail on the cap and the section rule specifically.
out="$(node "$here/lint-body.mjs" "$fx/fail-1117-walkthrough.md")"
printf '%s' "$out" | grep -q 'lines above ## Verification' && echo "ok   1117 trips the 40-line cap" || { echo "FAIL 1117 cap"; fails=$((fails + 1)); }
printf '%s' "$out" | grep -q 'sections must be ' && echo "ok   1117 trips the section rule" || { echo "FAIL 1117 sections"; fails=$((fails + 1)); }

expect 0 "$(hook "gh pr view 12")" "hook ignores a read"
expect 2 "$(hook "gh pr create --body-file '$fx/fail-screenshots-missing.md'")" "hook requires the Screenshots section on new writes"
expect 0 "$(hook "gh pr edit 12 --add-label agent-authored")" "hook allows an edit with no body"
expect 0 "$(hook "gh pr create --draft --base main --title 't' --body-file pass-filled.md --label agent-authored")" "hook allows a passing body file"
expect 0 "$(hook "agh pr create --draft --body-file=pass-filled.md")" "hook allows agh with --body-file="
expect 2 "$(hook "gh pr create --draft --body-file fail-1117-walkthrough.md")" "hook blocks a failing body file"
expect 2 "$(hook "gh pr create --draft --title t --body 'inline'")" "hook blocks --body"
expect 2 "$(hook "gh pr edit 12 -b 'inline'")" "hook blocks -b"
expect 0 "$(hook "gh api repos/o/r/pulls/12 --jq .draft")" "hook ignores a pulls read"
expect 0 "$(hook "gh api repos/o/r/pulls -X POST --input pass-filled.json")" "hook allows a passing api payload"
expect 2 "$(hook "gh api repos/o/r/pulls -X POST --input fail-payload.json")" "hook blocks a failing api payload"
expect 2 "$(hook "gh pr create --draft --title t --fill")" "hook blocks --fill on create"
expect 2 "$(hook "gh pr create --draft --title t")" "hook blocks a create with no body file"
expect 2 "$(hook "gh pr create --web")" "hook blocks --web on create"
expect 0 "$(hook "gh pr create --draft --body-file pass-footer-platform.md")" "hook tolerates the platform footer after the attribution line"
expect 2 "$(hook "gh pr create --draft --body-file fail-no-attribution.md")" "hook requires the attribution line"
expect 0 "$(hook "gh api repos/o/r/pulls --input pass-filled.json")" "hook allows an implicit POST with a passing payload"
expect 2 "$(hook "gh api repos/o/r/pulls --input fail-payload.json")" "hook blocks an implicit POST with a failing payload"
expect 2 "$(hook "gh api repos/o/r/pulls/12 -X PATCH --input fail-payload.json")" "hook blocks a PATCH with a failing payload"
expect 2 "$(hook "gh api repos/o/r/pulls -f title=t -f body='inline' -f head=b -f base=main")" "hook blocks a raw body field"
expect 2 "$(hook "gh api repos/o/r/pulls/12 -X PATCH --raw-field body=inline")" "hook blocks --raw-field body on an edit"
expect 2 "$(hook "gh api repos/o/r/pulls -F body=@pass-filled.md -f title=t")" "hook blocks -F body=@file"
expect 0 "$(hook "gh api repos/o/r/pulls/12 -X PATCH -f state=closed")" "hook allows a PATCH without a body"
expect 0 "$(hook "gh api repos/o/r/pulls/12/reviews -X POST -f event=APPROVE")" "hook ignores a review post"
expect 0 "$(hook "gh pr create --draft --title t --body 'inline'" "")" "hook passes through an interactive session"
expect 0 "$(hook "gh pr create --draft --title t --body 'inline'" "birdbrain-reviewer")" "hook passes through an unbound agent"
expect 2 "$(BIRDBRAIN_DISPATCH=1 hook "gh pr create --draft --title t --body 'inline'" "")" "hook binds a headless dispatch session"

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
