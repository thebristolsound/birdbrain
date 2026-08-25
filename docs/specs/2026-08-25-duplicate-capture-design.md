# What a duplicated Capture is

Written 2026-08-25 while implementing #827 (capability ticket under rulings R5, R13 and R14 of
`docs/plans/2026-08-24-wave3-phase2-intake-rulings.md`). The mock offers Duplicate on a capture,
and the app had no duplication route for any entity. Copying a string to the clipboard needs no
definition; copying a Capture does, because a Capture is an evidence object.

## The definition

A duplicate is **a byte-identical copy of a capture that currently verifies, recorded on the chain
as a copy, attributed to the operator who made it, and carrying none of the source's interpretive
state.**

Point by point:

- **Its own artifacts.** The MHTML, the screenshot, the extracted text and the thumbnail are copied
  to files named for the new capture id. The two rows never share a file, so deleting either one
  cannot take the other's bytes, and each verifies independently. Ruled by the issue body: "a new
  capture row with its own artifacts and its own manifest entry, never a second row pointing at the
  same bytes."
- **Its own signed manifest entry**, of type `capture`, carrying `method: 'duplicate'`,
  `duplicateOfCaptureId` and `duplicatedAt`. A capture with no entry behind it is a hole in the
  chain; an entry shared with another capture is worse.
- **The same `SHA-256`.** The bytes are the same bytes, so the digest is the same digest. That is
  what lets the copy verify against its own entry, and it is what an examiner comparing the two
  rows should see.
- **Honestly attributed.** The entry's `url` and `timestamp` describe the observation the bytes came
  from, which is the source's. Dating them to the copy would claim the page was visited again.
  `duplicatedAt` records when the copy was made and `operatorId`/`operatorName` record who made it.
  `toolVersion` is the version that wrote the entry. No field on the entry states something the
  duplicate did not do.
- **Refused unless the source verifies now.** One gate covers legacy, missing, tampered and
  chain-broken sources. Copying any of those would mint a fresh, internally consistent, signed entry
  for bytes that no longer stand up: the copy would verify while the thing it was taken from does
  not. A pre-chain MHTML row that verifies on its file hash alone is refused for the same reason,
  because duplicating it would give the copy the first chain entry those bytes ever had.
- **Re-anchored from the chain, not from the row.** Settings → Database can hand-edit the `captures`
  table. Every field the new entry re-states is read from the source's signed entry, so an edited
  mirror cannot be re-signed into the chain.

## What is not copied, and why

Tags, notes, annotations, analyses, selector matches, extracted data, favourites, and pinned Wayback
references stay with the source. Each of them is a judgement someone made about the original, or the
output of a run that happened against it. Attaching them to a row that was never examined would put
work in the record that nobody did, and copying selector matches or extracted items would count the
same observation twice in the coverage and Data screens.

The extracted text is the exception, and it is not interpretive: it mirrors the `.txt` artifact the
copy just took and anchored, so the duplicate is searchable exactly as far as its own artifacts
reach. A search for a phrase on the page therefore returns both rows, which is what having two rows
means.

## Accepted consequences

- **Trusted time is inherited by content hash.** A duplicate makes no separate request of the
  timestamp worker: any RFC 3161 token over the source's content hash already anchors these bytes,
  and a second request would ask the TSA to date the same observation twice. The copy's mirror is
  reconciled from the manifest, so it reads whatever the shared hash resolves to — `rfc3161` when a
  token exists, `pending` while the source is eligible and unstamped. A `pending` duplicate is in the
  retry queue like any other pending row, and whichever of the two the worker stamps, the resulting
  entry anchors both, because the axis is keyed by content hash.
- **A later selector backfill matches duplicates like any other row.** That is a property of having
  two rows, not of this change.
- **Duplicating a duplicate links to the row it was copied from**, not to the ultimate origin.
  Following the links one hop at a time is what reconstructs the sequence.
- **An older standalone verifier rejects a manifest containing a `duplicate` entry.** The entry
  schemas are strict and `method` is an enum, so a binary built before this change reads the new
  value as an invalid shape. This is the same forward-incompatibility the selection-scope fields
  (#398) already accepted. Backward verification is preserved in the other direction: the two new
  fields are omitted when absent, so every entry written before this change canonicalizes to the
  same bytes and keeps its hash.

## What this does not decide

Whether the duplicate should be reachable from a right-click context menu is #701's registry
question. This ticket ships the capability and the actions-menu item; the registry consumes the same
callback when it lands.
