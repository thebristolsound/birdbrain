#!/usr/bin/env bash
# Scrubs every file under .dispatch/ in place: credentials redacted in all of them, the
# spend dropped from the JSON ones. dispatch.yml runs it on every exit of the job, right
# before the artifact upload. run.sh scrubs after `claude` returns, but the transcript
# is written continuously and a cancel or the job timeout ends the run inside the call,
# so the raw stream would otherwise be what the `if: always()` upload step ships. Both
# passes are idempotent, so a normal run is scrubbed twice and changed once.
set -euo pipefail

# shellcheck source=.github/scripts/dispatch/redact.sh
. "$(dirname "${BASH_SOURCE[0]}")/redact.sh"

[ -d .dispatch ] || exit 0
# Listed in full first: each scrub writes a sibling file that a find still walking the
# folder could return.
mapfile -d '' -t files < <(find .dispatch -type f -print0)
for f in "${files[@]}"; do
  scrub "$f"
  case "$f" in *.json | *.jsonl) strip_spend "$f" ;; esac
done
