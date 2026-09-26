#!/usr/bin/env bash
# Runs the findings parser over the fixtures. Exit 1 on any unexpected result.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

out="$(node "$here/classify.mjs" --file "$here/fixtures/issue-1592.md" --dry-run)"
[ "$(echo "$out" | head -1 | grep -c '27 table findings')" -eq 1 ] && ok "parses 27 findings from #1592" || bad "expected 27 findings: $(echo "$out" | head -1)"
echo "$out" | grep -q $'^1a\tblocking\tyes\t' && ok "letter-suffixed ids keep their severity and evidence cells" || bad "row 1a missing or wrong"
[ "$(echo "$out" | grep -c $'^2\t')" -eq 1 ] && ok "a cross-referenced row (#2 under two screens) appears once" || bad "row 2 duplicated or missing"
echo "$out" | grep -q $'^13\tshould-fix\tyes\t' && ok "S maps to should-fix" || bad "S did not map to should-fix"
echo "$out" | grep -q $'^24\tpolish\tno\t' && ok "P maps to polish" || bad "P did not map to polish"
! echo "$out" | grep -q '\*\*' && ok "bold markers stripped from findings" || bad "bold markers leaked"

tmp="$(mktemp)"
printf '# A plain issue\n\nThe export button does nothing on Linux.\n' > "$tmp"
out="$(node "$here/classify.mjs" --file "$tmp" --dry-run)"
echo "$out" | grep -q 'whole issue as one finding' && ok "an issue without a findings table becomes one finding" || bad "fallback failed: $out"
rm -f "$tmp"

node "$here/classify.mjs" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "no argument exits 1" || bad "no argument exited $rc"

echo "$fails failure(s)"
[ "$fails" -eq 0 ]
