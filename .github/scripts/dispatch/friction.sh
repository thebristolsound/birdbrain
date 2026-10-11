#!/usr/bin/env bash
# Post the friction notes a scheduled run left in .dispatch/friction.md to the tracking
# issue, as the machine account (ADR-0050). Shared by dispatch.yml and pr-review.yml.
#
# A run with no notes leaves no file and posts nothing. The step appends the run, the
# commit it started from and the date, redacts credentials as scrub.sh does, and lints
# the result. A file that fails the linter is not posted: the step warns and exits 0,
# because a lost note costs less than a red run. A failed post exits non-zero, and the
# workflow step continues on error.
#
# Env: GH_TOKEN (machine token), RUN_URL, GITHUB_SHA.
set -euo pipefail

# The locked tracking issue the maintainer opened. Curation reads it; nothing else does.
FRICTION_ISSUE=0

here="$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=.github/scripts/dispatch/redact.sh
. "$here/redact.sh"

R="${GITHUB_REPOSITORY:-thebristolsound/birdbrain}"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
file=.dispatch/friction.md
out=.dispatch/friction-post.md
lint="$here/../../../.claude/skills/post-comment/scripts/check.sh"

note() { echo "Friction notes: $*" | tee -a "$summary"; }

if [ ! -s "$file" ]; then
  note "none from this run"
  exit 0
fi

notes="$(redact < "$file")"
printf '%s\n\n<details>\n<summary>Where these came from</summary>\n\nRun: %s\nCommit: %s\nDate: %s\n\n</details>\n' \
  "$notes" "${RUN_URL:?}" "${GITHUB_SHA:?}" "$(date -u +%F)" > "$out"

if ! bash "$lint" "$out"; then
  echo "::warning title=Friction notes not posted::the notes failed the comment linter; the findings are in this step's log"
  note "not posted, the file failed the comment linter"
  exit 0
fi

jq -n --rawfile body "$out" '{body: $body}' > .dispatch/friction-post.json
url="$(gh api -X POST "repos/$R/issues/$FRICTION_ISSUE/comments" --input .dispatch/friction-post.json --jq .html_url)"
note "posted $url"
