#!/usr/bin/env bash
# Prove CLAUDE_CODE_OAUTH_TOKEN can reach the API before anything expensive runs.
#
# `claude auth status` reports loggedIn:true for any well-formed token, so the
# only real test is a request. One Haiku call with a one-word answer costs a
# few cents; the alternative was the toolchain install that preceded every one
# of the 39 fires the dead token failed between 2026-09-20 and 2026-09-23.
#
# Env in: CLAUDE_CODE_OAUTH_TOKEN (secret).
#         CLAUDE_CODE_OAUTH_TOKEN_EXPIRES (variable, YYYY-MM-DD, optional): fails
#         when past, warns inside WARN_DAYS, notes when unset. The GitHub token
#         has the same variable and identity.sh fails on it the same way.
#         CLAUDE_TOKEN_SOURCE (optional): token, the default, or login. The local
#         dispatch host (scripts/dispatch-local.sh) sets login to probe the account
#         the CLI holds in its config directory; the token variable may then be
#         unset, and the expiry variable, which describes the token, is not read.
# Exit 1 on any failure, with the reason on stderr and the credential redacted.
set -euo pipefail

WARN_DAYS=14
redact() { sed -E 's/sk-ant-[A-Za-z0-9_-]{6}[A-Za-z0-9_-]*/sk-ant-<REDACTED>/g'; }

source="${CLAUDE_TOKEN_SOURCE:-token}"
subject="CLAUDE_CODE_OAUTH_TOKEN"
expires=""
case "$source" in
  login)
    subject="the CLI's stored login"
    [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] \
      || echo "::notice::CLAUDE_TOKEN_SOURCE=login, but CLAUDE_CODE_OAUTH_TOKEN is set and the CLI prefers it"
    ;;
  token)
    : "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN secret is not set}"
    if [[ "$CLAUDE_CODE_OAUTH_TOKEN" == *$'\n'* || "$CLAUDE_CODE_OAUTH_TOKEN" == *$'\r'* ]]; then
      echo "CLAUDE_CODE_OAUTH_TOKEN holds a line break; re-set it with gh secret set NAME --body "$(cat file)" so the substitution strips it" >&2
      exit 1
    fi

    today="$(date -u +%F)"
    expires="${CLAUDE_CODE_OAUTH_TOKEN_EXPIRES:-}"
    if [ -n "$expires" ]; then
      if [[ "$expires" < "$today" ]]; then
        echo "CLAUDE_CODE_OAUTH_TOKEN expired on $expires; re-mint with 'claude setup-token' and update the variable" >&2
        exit 1
      fi
      days=$(( ( $(date -u -d "$expires" +%s) - $(date -u -d "$today" +%s) ) / 86400 ))
      if [ "$days" -le "$WARN_DAYS" ]; then
        echo "::warning::CLAUDE_CODE_OAUTH_TOKEN expires in $days day(s), on $expires"
      fi
    else
      echo "::notice::CLAUDE_CODE_OAUTH_TOKEN_EXPIRES is not set; the probe cannot warn ahead of expiry"
    fi
    ;;
  *)
    echo "CLAUDE_TOKEN_SOURCE must be token or login, not '$source'" >&2
    exit 1
    ;;
esac

# From an empty directory so the probe carries no project context, hooks or
# settings, and the request is as small as the CLI makes it.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
set +e
(cd "$tmp" && claude -p 'Reply with the single word ok.' \
  --model claude-haiku-4-5-20251001 \
  --max-turns 1 \
  --output-format json \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  > "$tmp/result.json" 2> "$tmp/claude.err")
status=$?
set -e
redact < "$tmp/result.json" > "$tmp/result.redacted"
redact < "$tmp/claude.err" > "$tmp/err.redacted"

# A 401 exits 0 with is_error:true, so the exit status alone proves nothing.
is_error="$(jq -r 'if type=="array" then (map(select(.type=="result")) | last) else . end | .is_error // false' "$tmp/result.redacted" 2>/dev/null || echo parse-failed)"
if [ "$status" -ne 0 ] || [ "$is_error" != "false" ]; then
  reason="$(jq -r 'if type=="array" then (map(select(.type=="result")) | last) else . end | "\(.api_error_status // "no status"): \(.result // "no result")"' "$tmp/result.redacted" 2>/dev/null || echo 'unparseable result')"
  echo "$subject probe failed (exit $status): $reason" >&2
  tail -n 20 "$tmp/err.redacted" >&2
  exit 1
fi
echo "$subject probe ok${expires:+, expires $expires}"
