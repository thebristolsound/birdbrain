# Keep syncing after an imported row id collides

**Status:** done, finished by [#1967](https://github.com/thebristolsound/birdbrain/pull/1967)

This is the implementation handoff for #1955. An archive import can retain a note or tag id
under the importing installation's local authorship. When its original writer later shares
the Case, a signed edit or deletion under that id currently rolls back every working row in
the session. The issue permits refusing that row individually while continuing other work.

The Members screens are in draft PR #1965. Draft PR #1966 addresses the separate unreachable
Capture offer problem. Both sync defects must merge before Members entry points are added.

## Reproduction

The regression exports an older note, imports it on the second installation, joins the Owner's
Case, then edits or deletes the older note. A third variant exports a note already signed by
the Owner. All three variants reproduced the session rollback and missing later notes on two
successive pulls. The imported local row remained present; the collision blocked valid work.

## Change and decisions taken

The unsigned archive header cannot establish ownership, so the change refuses the incoming
collision instead of adopting its authorship or changing the held local row. A repository
query reports id collisions against held rows of another author. The working-layer service
checks the verified rows from every page before applying them, refuses demonstrated collisions
and tag applications that reference them, and applies the remaining rows in the existing
transaction. The receiver reports each refusal with its author. An application of a colliding
tag must also be refused, or it would silently apply the held tag's different meaning.

The raw database apply guard still refuses a collision. Missing references still roll back the
remaining batch, and signature, Case and author validation still precede this filter.
Migration 42 adds a local working-row cursor table so a session containing only verified
refusals can resume beyond its page limit. The cursor commits with the batch and restores with
the database. Cursor-free tags, unverifiable rows and failed transactions move it nowhere.
The manifest, signature envelope, protocol and dependencies stay unchanged. The change adds
no imported-id reconciliation. The ambiguous row can still be reported as refused while later
valid work arrives.

The older test expecting a collision to invalidate the whole batch changes because #1955
explicitly asks that one refused row no longer prevent unrelated rows from arriving. The test
still asserts that the held note is untouched, and separately keeps the missing-reference
rollback assertion. New coverage also refuses applications on both held and newly received
notes when their tag collides, including an application arriving before its parent rows.

## Next step

The three initial scenarios failed before the correction. Focused regression checks passed;
the dirty-tree check passed 2,321 related tests, all typechecks, formatting, lint and boundaries.
The cursor correction passes 70 focused sync checks. Run full verification at the corrected
clean head and recheck the two review findings before opening a draft PR carrying
`agent-authored` and `evidence-affecting`.

Next command:

```
cd /tmp/birdbrain-wt/shared-case-1955-1 && tail -40 /home/matt/.cache/birdbrain-1514/1955-preflight-r2.log
```

No merge or release is authorized. Keep the worktree for review fixes. Entry points remain
gated on the two defect merges; the real two-network relay sync remains a maintainer action.

## Review corrections

The first spec review found that a backlog containing only refused rows could consume all
1,000 pages, then repeat from the same cursor forever. The new two-peer regression uses
one-row pages and an imported backlog, reproduces the missing later note after the second
session, and now reaches that note. Verified progress lives in the database with the rows,
so restoring a database also restores its cursor. Migration and database checks passed 180
tests, including a populated v41 upgrade, rerunning the migration, Case and author scope,
deletion and database restoration.

The plan status now uses `active`, the vocabulary required by `docs/README.md`. The prose
correction removes the sentence opening reported by Vale. The prior full run passed every
code check and 7,565 tests but failed that prose check, so its block is not the final proof.

The second spec review found that a tag application on an imported note failed the existing
Case check before the collision filter could record progress. With one-row pages, that
application repeatedly stopped the next request. The new archive regression reproduced the
missing later note on two sessions. A signature-verified application signed for the syncing
Case now contributes refusal progress when its note id belongs to another Case. It remains
refused and never writes into that Case. Invalid signatures and envelopes naming another
Case still move no cursor. The refusal progress commits only if the remaining batch succeeds.
The focused sync and migration checks passed after this correction. A further regression
checks the Case boundary, invalid signatures, and rollback of refusal progress with a failed
batch. The standards reviewer reached its account limit; the final recheck uses another
configured provider.

## Merged dependency baseline

The maintainer merged PR #1968 as `eed80c8f`. This branch now includes that main
commit. The merge preserves this fix's source and regression tests. The frozen
dependency installation and dependency audit exit 0.

1. [x] Merge the updated main branch without rewriting existing commits.
2. [x] Install the frozen dependency lockfile.
3. [x] Run the dependency audit.
4. [ ] Run clean-head full verification.
5. [ ] Refresh the PR's verification details.
6. [ ] Push the updated branch for CI.

Next command:

```sh
BIRDBRAIN_TEST_SYSTEM_SHARP=1 PKG_CONFIG_PATH=/usr/lib/pkgconfig mise x -- pnpm preflight
```
