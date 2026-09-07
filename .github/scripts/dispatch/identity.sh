#!/usr/bin/env bash
# Materialise the machine identity the dispatch skill expects, then prove it.
#
# Writes ~/.config/birdbrain-agent/env with the modes ADR-0012 prescribes, so the
# skill's own identity check runs unchanged on this host. Fails the job when the
# token is missing, expired, or resolves to any login but the machine account:
# a fire that cannot write as birdbrain-agent must not write at all (ADR-0012
# rule 2), and it must say so loudly rather than idle (#960).
#
# Env in: BIRDBRAIN_AGENT_GH_TOKEN, BIRDBRAIN_AGENT_GH_LOGIN,
#         BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES (YYYY-MM-DD), GITHUB_REPOSITORY_OWNER.
# Outputs: login, id, started (UTC timestamp every later step measures from).
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
started="$(date -u +%FT%TZ)"

: "${BIRDBRAIN_AGENT_GH_TOKEN:?BIRDBRAIN_AGENT_GH_TOKEN secret is not set}"
: "${BIRDBRAIN_AGENT_GH_LOGIN:?BIRDBRAIN_AGENT_GH_LOGIN variable is not set}"
: "${BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES:?BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES variable is not set}"

today="$(date -u +%F)"
if [[ "$BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES" < "$today" ]]; then
  echo "Machine token expired on $BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES; rotate it with scripts/setup-agent-github-account.sh" >&2
  exit 1
fi

dir="$HOME/.config/birdbrain-agent"
install -d -m 0700 "$dir"
umask 077
cat > "$dir/env" <<EOF
BIRDBRAIN_AGENT_GH_LOGIN=$BIRDBRAIN_AGENT_GH_LOGIN
BIRDBRAIN_AGENT_GH_TOKEN=$BIRDBRAIN_AGENT_GH_TOKEN
BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES=$BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES
EOF
chmod 0600 "$dir/env"

# The same probe the skill runs. GH_TOKEN is the machine token for the whole job.
who="$(GH_TOKEN="$BIRDBRAIN_AGENT_GH_TOKEN" gh api user --jq '"\(.login)\t\(.id)"')"
login="${who%%$'\t'*}"
id="${who#*$'\t'}"
if [ "$login" != "$BIRDBRAIN_AGENT_GH_LOGIN" ]; then
  echo "Token resolves to '$login', expected '$BIRDBRAIN_AGENT_GH_LOGIN'; refusing to run" >&2
  exit 1
fi
if [ "$login" = "${GITHUB_REPOSITORY_OWNER:-}" ]; then
  echo "Token resolves to the repository owner; ADR-0012 forbids dispatch under that identity" >&2
  exit 1
fi

# Commit authorship follows the account that pushes (ADR-0026).
git config user.name "$login"
git config user.email "${id}+${login}@users.noreply.github.com"

{
  echo "login=$login"
  echo "id=$id"
  echo "started=$started"
} >> "$out"
echo "Identity: $login (id $id), token expires $BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES, run started $started"
