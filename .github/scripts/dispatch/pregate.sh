#!/usr/bin/env bash
# Decide from the API alone whether this fire has anything to do.
#
# The full cycle costs a toolchain install and a Claude session. Most hours it
# would find three occupied slots with nothing owed and exit, so this step asks
# the cheap version of the skill's sections 1 to 3 first and skips the rest when
# every answer is "nothing". It never writes. It is deliberately conservative:
# any doubt reads as "run", because a missed cycle costs an hour and a spurious
# one costs minutes.
#
# $1 = mode. report mode always runs; it exists to compare a runner's
# classification against an interactive session's.
# Env: GH_TOKEN (machine token). Output: run=true|false, reason.
set -euo pipefail

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
mode="${1:-cycle}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

decide() {
  echo "run=$1" >> "$out"
  echo "reason=$2" >> "$out"
  echo "Pre-gate: run=$1 ($2)" | tee -a "$summary"
  exit 0
}

[ "$mode" = report ] && decide true "report mode always runs"

# One array per page from --paginate; slurp and merge so a second page is not lost (#959).
list() { gh api --paginate "$1" | jq -s 'add // []'; }

prs="$(list "repos/$R/issues?state=open&labels=agent-pr&per_page=100" | jq '[.[] | select(.pull_request) | .number]')"
wip="$(list "repos/$R/issues?state=open&labels=agent-wip&per_page=100" | jq '[.[] | select(.pull_request | not) | .number]')"
occupancy=$(( $(jq length <<<"$prs") + $(jq length <<<"$wip") ))
echo "Occupancy $occupancy/3: agent-pr PRs $prs, agent-wip claims $wip" | tee -a "$summary"

# Section 2: does any open agent PR need the routine?
for n in $(jq -r '.[]' <<<"$prs"); do
  pr="$(gh api "repos/$R/pulls/$n")"
  sha="$(jq -r .head.sha <<<"$pr")"
  draft="$(jq -r .draft <<<"$pr")"
  state="$(gh api "repos/$R/commits/$sha/status" \
    --jq '[.statuses[] | select(.context=="agent/pre-pass")][0].state // "absent"')"
  case "$state" in
    success|failure) ;;
    *) decide true "PR #$n head ${sha:0:8} has agent/pre-pass=$state; a verdict is owed" ;;
  esac
  head_at="$(gh api "repos/$R/commits/$sha" --jq .commit.committer.date)"
  newest="$( {
      gh api --paginate "repos/$R/issues/$n/comments?per_page=100" | jq -r '.[] | .created_at'
      gh api --paginate "repos/$R/pulls/$n/comments?per_page=100" | jq -r '.[] | .created_at'
      gh api --paginate "repos/$R/pulls/$n/reviews?per_page=100" | jq -r '.[] | .submitted_at // empty'
    } | sort | tail -1)"
  if [ -n "$newest" ] && [[ "$newest" > "$head_at" ]]; then
    decide true "PR #$n has activity at $newest newer than its head ($head_at)"
  fi
  if [ "$state" = success ] && [ "$draft" = false ]; then
    labels="$(gh api "repos/$R/issues/$n/labels" --jq '[.[].name]')"
    if ! jq -e 'index("evidence-affecting")' <<<"$labels" >/dev/null; then
      decide true "PR #$n is approved, ready and non-evidence; section 2a may merge it"
    fi
  fi
done

# Section 3: is there room, and anything to put in it?
if [ "$occupancy" -lt 3 ]; then
  frontier="$(list "repos/$R/issues?state=open&labels=ready-for-agent&per_page=100" \
    | jq '[.[] | select(.pull_request | not) | select(.assignees | length == 0) | .number] | length')"
  if [ "$frontier" -gt 0 ]; then
    decide true "$((3 - occupancy)) slot(s) free and $frontier unassigned ready-for-agent issue(s)"
  fi
  decide false "$((3 - occupancy)) slot(s) free but the frontier is empty"
fi

decide false "all three slots held and no open agent PR needs the routine"
