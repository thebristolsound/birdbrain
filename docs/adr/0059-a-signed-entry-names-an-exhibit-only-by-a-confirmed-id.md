# A signed entry names an Exhibit only by a confirmed id

**Status:** Accepted

**Date:** 2026-11-27

This record states rulings the maintainer made in an interactive session on 2026-11-27, while
answering the questions the re-check of the
[chain-reader plan](../plans/2026-10-02-manifest-chain-reader.md) raised, and two more the same
day on the review of this record. It makes ruling 3 of that plan's maintainer rulings of
2026-10-02 precise, relaxes it for a delete on a Case whose chains do not all verify, and amends
the plan's invariant 4. The defect it leaves to fix is #2283.

## Context

A Case Archive import always creates a new Case, and renames each row whose id collides with a
row already on the installation. The inherited Manifest Entry keeps naming the Exhibit by its
Chain Id, the id it was signed under, and both package verifiers find the Exhibit's file, index
rows and place in a signed selection by that id. The id map the `import` entry anchors by digest
says which row each renamed id became. When that map is missing, altered or cannot be composed,
the rename cannot be confirmed.

A Case's chains are its local Manifest and, in a Shared Case, every member chain it holds. That is
the set Package Verification reads, and the set this record means wherever it says "the Case's
chains".

Three paths that sign entries did not wait for a confirmation:

- **Writers.** A deletion and the thumbnail backfill name an Exhibit by its row id whenever the
  rename is unconfirmed (#1876, #1872). Package Verification retires an Exhibit only through a
  deletion naming the id its own `capture` or `exhibit` entry carries, so a deletion under an id
  no chain wrote retires nothing. The original Exhibit stays active, and every later Evidence
  Package that includes it fails for its missing bytes. A selection that leaves it out does not
  fail.
- **Renumbering.** The one-time `renumber` entry assigns each Exhibit's number under its row id,
  with no rename check. An Exhibit renamed by an import gets its number under an id no chain
  wrote, so the original Exhibit has no signed number.
- **Selection export.** The `export` entry of a selection lists the Exhibits it encloses by Chain
  Id. Export infers a renamed row's Chain Id from the entry at the row's index over the same bytes
  (#1672, fixing #1657), and falls back to the row id when it cannot. The inference is bounded,
  but the entry that records it is signed and permanent.

## Considered options

- **Fall back to the row id.** What shipped. The writer never blocks the Operator, and the
  failure surfaces later, in a package that does not verify, far from the action that caused it.
- **Refuse whenever a rename is unconfirmed.** It also refuses a native row whose index someone
  edited on the Database screen, where the chain did write the row's own id and the row id is
  correct.
- **Refuse only when no signed record confirms the id.** Chosen. Ruling 3 asked a writer to
  resolve a renamed Exhibit through its own id or the signed id map; this states what resolving
  through its own id takes.

## Decision

1. **A Manifest Entry names an Exhibit only by a confirmed id.** That is its Confirmed Chain Id,
   or its own id when one of the Case's chains holds the `capture` or `exhibit` entry that
   acquired it under that id. Any other entry naming the id, an earlier deletion among them,
   confirms nothing. An inferred Chain Id never goes into a signed entry.
2. **A writer that has no confirmed id refuses.** This covers a single delete, a batch delete,
   the thumbnail backfill's parent and the one-time `renumber` entry. A refused delete tells the
   Operator which Exhibit it is and why, and offers no override. The backfill and the renumber
   skip that Exhibit and log why.
3. **A selection export refuses without a confirmed id.** An Evidence Package or a Working Copy
   of a selection signs confirmed ids only, and refuses when a selected Exhibit has none, whether
   export inferred its Chain Id or could not name it at all. A legacy Capture that has no Manifest
   Entry has no confirmed id either, so a selection that includes one refuses; such a selection
   already fails Package Verification. A full export signs no list and is unaffected.
4. **Inferred names may still name.** Every document an export writes, `evidence.json`, notes,
   the report and the Working Copy index among them, may name an Exhibit by an inferred Chain Id,
   so the documents agree with the files the package encloses.
5. **No repair of earlier deletions.** A Case where a release already signed a deletion under an
   id no chain wrote stays as it is: a signed entry cannot be removed.
6. **A Case whose chains do not all verify.** Nothing on such a Case can be confirmed, so rules 2
   and 3 would refuse everything there. Instead:
   - A delete keeps signing the row's own id, as it does today. It still removes the Exhibit's
     stored bytes, as any delete does. This relaxes ruling 3, which said a writer never signs an
     id it could not resolve.
   - A selection export refuses when a selected Exhibit's row id names no `capture` or `exhibit`
     entry in any of the Case's chains, which is true of every row an import renamed. Other rows
     export as today.

   The delete carries a known risk. A chain this build reads as broken may be genuine and verify
   under a later build that fixes #1199. A deletion signed meanwhile under an unconfirmed row id
   then retires nothing, and rule 5 leaves it unrepaired. That shape arises only when this build
   reads a chain a newer build wrote, through an archive import or by opening its storage after a
   downgrade. The maintainer accepted the risk over blocking every delete on a broken Case.

## Consequences

- An Operator can meet a refused delete on a Case whose import records are damaged, and a refused
  selection export there, on a Case whose chains do not all verify, and on a selection that
  includes a legacy Capture with no Manifest Entry. Each refusal names the cause; the Exhibit stays
  in the Case.
- Every writer that signs an Exhibit id, those named here and any added later, follows rule 1, and
  a reviewer can hold it to this record rather than to a plan.
- The chain-reader plan's `binds` accepts only own and id-map answers, and its `chainName` may
  answer `'inferred'` for naming only. Its `'own'` means what rule 1 means by a row's own id. All
  three follow from rules 1 and 4.
