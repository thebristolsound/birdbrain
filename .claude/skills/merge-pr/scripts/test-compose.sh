#!/usr/bin/env bash
# Runs compose.mjs over the post-pr-body fixtures. Exit 1 on any unexpected result.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fx="$here/../../post-pr-body/scripts/fixtures"
out="$(mktemp -d)"
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

node "$here/compose.mjs" "$fx/pass-filled.md" "feat(x): a thing" 12 "$out" >/dev/null 2>&1 \
  && ok "composes from a passing body" || bad "composes from a passing body"
[ "$(cat "$out/subject.txt")" = "feat(x): a thing (#12)" ] && ok "subject is title (#n)" || bad "subject is title (#n)"
[ -s "$out/body.txt" ] && ok "body is not empty" || bad "body is not empty"
! grep -q '^## ' "$out/body.txt" && ok "body carries no headings" || bad "body carries no headings"
! grep -q 'Pull request description generated' "$out/body.txt" && ok "body carries no attribution line" || bad "attribution line leaked"
! grep -q 'preflight' "$out/body.txt" && ok "body carries no Verification text" || bad "Verification text leaked"
[ -z "$(awk 'length > 72' "$out/body.txt")" ] && ok "body wraps at 72" || bad "body line over 72"

node "$here/compose.mjs" "$fx/fail-first-line.md" "t" 1 "$out" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "a body with a Summary still composes (shape is post-pr-body's job)" || bad "unexpected exit $rc"
printf 'Closes #1\n\n## Changes\n- x\n' > "$out/nosummary.md"
node "$here/compose.mjs" "$out/nosummary.md" "t" 1 "$out" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "no Summary exits 1" || bad "no Summary exits $rc"

rm -rf "$out"
echo "$fails failure(s)"
[ "$fails" -eq 0 ]
