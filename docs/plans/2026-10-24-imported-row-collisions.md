# Keep syncing after an imported row id collides

**Status:** verification

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
remaining batch, and signature, Case and author validation still precede this filter. There is
no schema, manifest, signature envelope, protocol or dependency change. Imported-id
reconciliation is not added. The ambiguous row can still be reported as refused while later
valid work arrives.

The older test expecting a collision to invalidate the whole batch changes because #1955
explicitly asks that one refused row no longer prevent unrelated rows from arriving. The test
still asserts that the held note is untouched, and separately keeps the missing-reference
rollback assertion. New coverage also refuses applications on both held and newly received
notes when their tag collides, including an application arriving before its parent rows.

## Next step

The three initial scenarios failed before the correction. Focused regression checks passed;
the dirty-tree check passed 2,321 related tests, all typechecks, formatting, lint and boundaries.
Commit this slice, run full verification at its clean head, then obtain independent standards
and spec reviews before opening a draft PR carrying
`agent-authored` and `evidence-affecting`.

Next command:

```
cd /tmp/birdbrain-wt/shared-case-1955-1 && tail -40 /home/matt/.cache/birdbrain-1514/1955-preflight.log
```

No merge or release is authorized. Keep the worktree for review fixes. Entry points remain
gated on the two defect merges; the real two-network relay sync remains a maintainer action.
