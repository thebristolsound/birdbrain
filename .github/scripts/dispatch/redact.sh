#!/usr/bin/env bash
# redact(): copies stdin to stdout, keeping the prefix of any value that starts
# with one of the six prefixes in the pattern and replacing the rest of the value
# with <REDACTED>. Sourcing this file defines the function and does nothing else,
# so a test can load it without running a dispatch cycle.
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
