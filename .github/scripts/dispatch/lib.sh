#!/usr/bin/env bash
# Strings, constants and reads two dispatch steps must agree on character for character.
#
# cleanup.sh writes CLEANUP_FAILURE_DESC on a pre-pass whose run it interrupted;
# pregate.sh matches CLEANUP_FAILURE_PREFIX to tell that interrupted review from a
# real `request changes` verdict, which is terminal for the gate and the
# interrupted one is not. Change one side only and the match silently stops
# holding, which reads as "the PR needs nothing" rather than as an error.
#
# CLAIM_MAX_AGE is section 1's 4-hour expiry, in the form `date -d` accepts.

CLEANUP_FAILURE_PREFIX='Dispatch run ended'
PENDING_TEXT='Reviewer pre-pass running.'
CLAIM_MAX_AGE='4 hours ago'
# The dispatch skill parks a stopped PR under this label and pregate.sh skips it; rename both.
AWAITING_MAINTAINER_LABEL='awaiting-maintainer'
# The one account the spend ruling on #1310 trusts besides the pipeline itself.
MAINTAINER='thebristolsound'

# One array per page from --paginate; slurp and merge so a second page is not lost (#959).
list() { gh api --paginate "$1" | jq -s 'add // []'; }

# Every status context on commit $2 of repository $1, as {"<context>": {state,
# desc, at, ignored}}: the newest status the maintainer or the pipeline (login
# $3, which may be empty) posted, or state "absent" when neither did, and every
# newer status from anyone else. Anyone with push access can post a status
# under any context, and a workflow on any branch posts as github-actions[bot],
# so no other creator counts. The combined status names no creator; this list
# does, newest first. "Session rules" in the dispatch skill states the same rule.
trusted_statuses() {
  list "repos/$1/commits/$2/statuses?per_page=100" \
    | jq -c --arg owner "$MAINTAINER" --arg me "$3" '
      reduce (.[] | {context, state, desc: (.description // ""), by: (.creator.login // ""),
          at: .created_at} | .trusted = (.by == $owner or ($me != "" and .by == $me))) as $s
        ({}; .[$s.context] += [$s])
      | map_values(. as $all
        | (([$all[] | .trusted] | index(true)) // ($all | length)) as $i
        | {state: ($all[$i].state // "absent"), desc: ($all[$i].desc // ""),
            at: ($all[$i].at // ""), ignored: $all[:$i]})'
}
