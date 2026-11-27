# A signed entry names an Exhibit only by a confirmed id

**Status:** Accepted

**Date:** 2026-11-27

This record states rulings the maintainer made in an interactive session on 2026-11-27, while
answering the questions the re-check of the
[chain-reader plan](../plans/2026-10-02-manifest-chain-reader.md) raised. It narrows ruling 3 of
that plan's maintainer rulings of 2026-10-02, and amends the plan's invariant 4. The defect it
leaves to fix is #2283.

## Context

A Case Archive import renames a row whose id collides with one the importing Case already holds.
The inherited Manifest Entry keeps naming the Exhibit by its Chain Id, the id it was signed under,
and both package verifiers find the Exhibit's file, index rows and place in a signed selection by
that id. The id map the `import` entry anchors by digest says which row each renamed id became.
When that map is missing, altered or cannot be composed, the rename cannot be confirmed.

Two paths that sign entries did not wait for a confirmation:

- **Writers.** A deletion, the interrupted-delete repair and the thumbnail backfill name an
  Exhibit by its row id whenever the rename is unconfirmed (#1876, #1872). Package Verification
  counts a deletion only for an id some chain authored, so a deletion under an id the chain never
  wrote removes nothing. The original Exhibit stays active, and every later Evidence Package of the
  Case fails for its missing bytes.
- **Selection export.** The `export` entry of a selection lists the Exhibits it encloses by Chain
  Id, and export infers a renamed row's Chain Id from the entry at the row's index over the same
  bytes (#1672). The inference is bounded, but the entry that records it is signed and permanent.

## Considered options

- **Fall back to the row id.** What shipped. The writer never blocks the Operator, and the
  failure surfaces later, in a package that does not verify, far from the action that caused it.
- **Refuse whenever a rename is unconfirmed.** Ruling 3 as written on 2026-10-02. It also refuses
  a native row whose index someone edited on the Database screen, where the chain did write the
  row's own id and the row id is correct.
- **Refuse only when no signed record confirms the id.** Chosen.

## Decision

1. **A Manifest Entry names an Exhibit only by a confirmed id.** That is its Confirmed Chain Id,
   or its own id when the chain wrote an entry for that id. An inferred Chain Id never goes into a
   signed entry.
2. **A writer that has no confirmed id refuses.** This covers a single delete, a batch delete,
   the interrupted-delete repair and the thumbnail backfill's parent. A refused delete tells the
   Operator which Exhibit it is and why, and offers no override. The backfill skips that thumbnail
   and logs why.
3. **A selection export refuses on an inferred id.** An Evidence Package or a Working Copy of a
   selection signs confirmed ids only, and refuses when a selected Exhibit's Chain Id is only
   inferred. A full export signs no list and is unaffected.
4. **Inferred names may still name.** Every document an export writes, `evidence.json`, notes,
   the report and the Working Copy index among them, may name an Exhibit by an inferred Chain Id,
   so the documents agree with the files the package encloses.
5. **No repair of earlier deletions.** A Case where an earlier release already signed a deletion
   under an id no chain wrote stays as it is: a signed entry cannot be removed.

## Consequences

- An Operator can meet a refused delete or a refused selection export on a Case whose import
  records are damaged. The refusal names the cause; the Exhibit stays in the Case.
- Every writer added later that signs an Exhibit id follows rule 1, and a reviewer can hold it to
  this record rather than to a plan.
- The chain-reader plan's `binds` accepts only own and id-map answers, and its `chainName` may
  answer `'inferred'` for naming only. Both follow from rules 1 and 4.
