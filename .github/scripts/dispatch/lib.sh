#!/usr/bin/env bash
# Strings and constants two dispatch steps must agree on character for character.
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
