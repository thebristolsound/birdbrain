# Keep unreachable Capture rows local

**Status:** verification

This is the implementation handoff for #1951, the Shared Case sync failure caused by a signed
working row on an imported or legacy Capture. The issue recommends filtering the offer rather
than expanding imported history or weakening the receiver's checks. The Members screens are
in draft PR #1965. Entry points remain deferred until #1951 and #1955 merge.

## Reproduction and change

The two-peer regression creates an imported or legacy Capture, shares the Case, then writes a
note, tag applications, annotation layer and pin on that Capture. Both sync attempts failed
with a missing-Capture reference and withheld a valid later note before the fix.

The live source now derives the ids other members can hold from the current segments of its
local and remote member chains. The row query filters Capture and Exhibit references, and tag
applications on a note whose Capture stays local, before limiting a page. Loose notes still
travel. A current-segment creation remains eligible after deletion, so retained rows and
tombstones keep travelling under the existing deletion rules. The receiver, signatures,
evidence entries, schemas and protocol are unchanged.

The optional query filter preserves existing database-only readers; the live sync source
always supplies it. The implementation uses the existing `idsReachingMembers` rule and SQLite
JSON membership, with no new dependency or migration.

## Verification and next step

The initial regression failed for both Capture types and on repeated sync attempts. After the
fix, 101 focused checks passed, including older-row signing, transitive sync and retained rows
on deleted Captures. A further regression checks filtering before a small page limit, excluded
note parents, loose notes, and whole eligible version groups. The dirty-tree check passed
2,320 related tests, all six typechecks, formatting, lint and boundaries.

Next command:

```
cd /tmp/birdbrain-wt/shared-case-1951-1 && tail -40 /home/matt/.cache/birdbrain-1514/1951-preflight.log
```

This slice is ready for clean-head verification and independent standards and spec reviews,
then a draft PR with `agent-authored` and `evidence-affecting`. Keep #1955 in
its own change. Human review and merge remain required; the real two-network relay check is
also a maintainer action.
