#!/usr/bin/env bash
# Twice-daily health check for the scheduled automation: are the two credentials
# the scheduled workflows carry alive, has any scheduled workflow gone red and
# stayed red, and has the agent pipeline stalled while staying green (stall.sh)?
# Writes every finding to .health/findings.md and sets the `findings` output;
# alert.sh turns that file into the alert issue.
#
# Why this exists: the dispatch fire failed 39 times in a row on an invalid
# CLAUDE_CODE_OAUTH_TOKEN (2026-09-20 to 2026-09-23) and the doc curator every
# Monday from 2026-08-24, and nothing said so. A red run in the Actions tab is
# not an alert.
#
# Env in: GH_TOKEN (github.token, reads run history), GITHUB_REPOSITORY,
#         BIRDBRAIN_AGENT_GH_TOKEN, BIRDBRAIN_AGENT_GH_LOGIN,
#         BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES (as identity.sh),
#         CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN_EXPIRES (as claude-token.sh).
# Output: findings=true|false.
set -euo pipefail

WARN_DAYS=14
# Two consecutive scheduled failures is an alert: one can be a runner flake,
# two of the same job is a condition. For the 4-hourly dispatch that is eight
# hours; for the weekly jobs, two weeks.
STREAK=2
WORKFLOWS=(dispatch.yml doc-curator.yml stale-agent-issues.yml)

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
here="$(dirname "${BASH_SOURCE[0]}")"
mkdir -p .health
findings=.health/findings.md
: > "$findings"
finding() { printf -- '- %s\n' "$1" >> "$findings"; echo "FINDING: $1" >&2; }
today="$(date -u +%F)"
days_until() { echo $(( ( $(date -u -d "$1" +%s) - $(date -u -d "$today" +%s) ) / 86400 )); }

# 1. The machine account's GitHub token: same three checks as identity.sh, but a
#    failure is a finding rather than an exit, so the other checks still run.
if [ -z "${BIRDBRAIN_AGENT_GH_TOKEN:-}" ]; then
  finding 'BIRDBRAIN_AGENT_GH_TOKEN secret is not set'
else
  login="$(GH_TOKEN="$BIRDBRAIN_AGENT_GH_TOKEN" gh api user --jq .login 2>/dev/null || true)"
  if [ -z "$login" ]; then
    finding 'BIRDBRAIN_AGENT_GH_TOKEN is rejected by GitHub (gh api user failed); rotate it with scripts/setup-agent-github-account.sh'
  elif [ "$login" != "${BIRDBRAIN_AGENT_GH_LOGIN:-}" ]; then
    finding "BIRDBRAIN_AGENT_GH_TOKEN resolves to '$login', expected '${BIRDBRAIN_AGENT_GH_LOGIN:-<unset>}'"
  fi
fi
if [ -z "${BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES:-}" ]; then
  finding 'BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES variable is not set; identity.sh fails every dispatch fire without it'
elif [[ "$BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES" < "$today" ]]; then
  finding "BIRDBRAIN_AGENT_GH_TOKEN expired on $BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES; rotate it with scripts/setup-agent-github-account.sh"
else
  d="$(days_until "$BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES")"
  [ "$d" -le "$WARN_DAYS" ] && finding "BIRDBRAIN_AGENT_GH_TOKEN expires in $d day(s), on $BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES; rotate it with scripts/setup-agent-github-account.sh"
fi

# 2. The Claude token, through the same probe dispatch.yml runs before its
#    toolchain install. Its stderr is the finding text.
if ! probe_err="$(bash "$here/claude-token.sh" 2>&1 >/dev/null)"; then
  finding "$(printf '%s' "$probe_err" | head -n 1)"
fi

# 3. Failure streaks. Only scheduled runs count: a supervised workflow_dispatch
#    fire is someone already looking. Idle dispatch fires exit green at the
#    pre-gate, so a streak here is a fire that had work and could not do it.
#    A workflow the owner disabled (the paused doc curator) is skipped: its
#    old streak is a known, chosen state, not a regression.
for wf in "${WORKFLOWS[@]}"; do
  state="$(gh api "repos/$R/actions/workflows/$wf" --jq .state 2>/dev/null || echo unknown)"
  [ "$state" = disabled_manually ] && continue
  runs="$(gh api "repos/$R/actions/workflows/$wf/runs?event=schedule&status=completed&per_page=50" \
    --jq '[.workflow_runs[] | {conclusion, created_at}]' 2>/dev/null || echo '[]')"
  total="$(jq 'length' <<< "$runs")"
  [ "$total" -lt "$STREAK" ] && continue
  streak="$(jq '[.[] | .conclusion] | (index("success") // length)' <<< "$runs")"
  if [ "$streak" -ge "$STREAK" ]; then
    since="$(jq -r ".[$((streak - 1))].created_at" <<< "$runs")"
    latest="$(jq -r '.[0].created_at' <<< "$runs")"
    qualifier=""
    [ "$streak" -ge "$total" ] && qualifier=" (every scheduled run on record)"
    finding "$wf: last $streak scheduled runs none succeeded$qualifier, $since to $latest; https://github.com/$R/actions/workflows/$wf?query=event%3Aschedule"
  fi
done

# 4. Stalls: pipeline work that should be moving while every run stays green.
if stalls="$(bash "$here/stall.sh")"; then
  while IFS= read -r line; do
    if [ -n "$line" ]; then finding "$line"; fi
  done <<< "$stalls"
else
  finding "stall.sh exited non-zero, so the stall rules did not all run; see the run log"
fi

if [ -s "$findings" ]; then
  echo "findings=true" >> "$out"
  echo "$(wc -l < "$findings") finding(s):" >&2
  cat "$findings" >&2
else
  echo "findings=false" >> "$out"
  echo "No findings." >&2
fi
