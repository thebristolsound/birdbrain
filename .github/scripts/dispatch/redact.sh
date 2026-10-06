#!/usr/bin/env bash
# redact(): copies stdin to stdout, keeping the prefix of any value that starts
# with one of the six prefixes in the pattern and replacing the rest of the value
# with <REDACTED>. scrub() applies it to a file in place, and strip_spend() drops
# the spend figures from a file of JSON lines. Sourcing this file defines the
# functions and does nothing else, so a test can load it without running a
# dispatch cycle; run.sh and scrub.sh both source it.
#
# An API error can quote the credential it was sent: a malformed
# CLAUDE_CODE_OAUTH_TOKEN came back inside the error message, and because the
# stored secret held a newline the value no longer matched GitHub's mask. The
# log was scrubbed, the artifact was not. GH_TOKEN, a GitHub token, sits in the
# same job environment, so five GitHub token prefixes are matched as well.
#
# A match needs six characters after the prefix, so text that only names a
# prefix passes through unchanged. A value runs on across a dot that has a value
# character after it, because GitHub's stateless installation token
# (ghs_APPID_JWT) carries a JWT whose three parts are joined by dots. A dot that
# ends a sentence has none after it, so it stays.
redact() {
  sed -E 's/(sk-ant-|ghp_|gho_|ghs_|ghu_|github_pat_)[A-Za-z0-9_-]{6}[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*/\1<REDACTED>/g'
}

scrub() { redact < "$1" > "$1.redacted" && mv "$1.redacted" "$1"; }

# Drops total_cost_usd and every modelUsage.<model>.costUSD wherever the envelope's
# shape puts them, so neither the artifact nor a failed call's log shows the spend
# (#1369). The transcript is one JSON event per line, so this works line by line, and
# a line jq cannot parse is kept as it is, so a failed call's stdout still gets logged.
strip_spend() {
  jq -R -r '. as $l | try (fromjson
    | walk(if type == "object" then del(.total_cost_usd, .costUSD) else . end) | tojson)
    catch $l' "$1" > "$1.stripped" && mv "$1.stripped" "$1"
}
