#!/usr/bin/env bash
# Pipes hook payloads through guard-maintainer-labels.sh. Exit 1 on any unexpected result.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard="$here/guard-maintainer-labels.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '{"labels":["merge"]}' >"$tmp/merge.json"
printf '{"labels":["merge-gate"]}' >"$tmp/gate.json"
fails=0

expect() {
  local want="$1" cmd="$2" got
  node -e 'process.stdout.write(JSON.stringify({tool_name:"Bash",cwd:process.argv[1],tool_input:{command:process.argv[2]}}))' "$tmp" "$cmd" \
    | "$guard" >/dev/null 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok   exit $got  $cmd"
  else
    echo "FAIL want $want got $got  $cmd"
    fails=$((fails + 1))
  fi
}

expect 2 'gh pr edit 12 --add-label merge'
expect 2 'gh pr edit 12 --add-label=merge'
expect 2 'gh pr edit 12 --add-label "agent-pr,merge"'
expect 2 'agh pr edit 12 --add-label approved'
expect 2 'gh issue edit 12 --add-label Approved'
expect 2 'git push && gh pr edit 12 --add-label merge'
expect 2 'gh api repos/o/r/issues/12/labels -f "labels[]=merge"'
expect 2 'gh api -X POST repos/o/r/issues/12/labels -f labels[]=agent-pr -f labels[]=approved'
expect 2 'gh api repos/o/r/issues/12/labels --input merge.json'
expect 2 'gh api repos/o/r/issues/12/labels --input - <<< x'
expect 2 'OTHER=1 gh pr edit 12 --add-label merge'
expect 0 'BIRDBRAIN_MAINTAINER_LABEL_OK=1 gh pr edit 12 --add-label merge'
expect 0 'BIRDBRAIN_MAINTAINER_LABEL_OK=1 gh api repos/o/r/issues/12/labels -f labels[]=approved'
expect 0 'gh pr edit 12 --remove-label merge'
expect 0 'gh pr edit 12 --add-label agent-pr --remove-label merge,approved'
expect 0 'gh pr edit 12 --add-label merge-gate'
expect 0 'gh pr edit 12 --add-label pre-merge,unapproved'
expect 0 'gh api -X DELETE repos/o/r/issues/12/labels/merge'
expect 0 'gh api repos/o/r/issues/12/labels'
expect 0 'gh api repos/o/r/issues/12/labels -f labels[]=merge-gate'
expect 0 'gh api repos/o/r/issues/12/labels --input gate.json'
expect 0 'gh pr view 12 --json labels'
expect 0 'echo "gh pr edit 12 --add-label merge" > notes.txt'
expect 0 'git commit -m "docs: mention --add-label merge"'

[ "$fails" -eq 0 ] || exit 1
