# One Transaction Record per Capture, stored inside the Capture

**Status:** Accepted

**Date:** 2026-09-30

Grilled and confirmed by the maintainer on 2026-09-29. Nothing in this record is implemented.
The first slice is designed in
[the capture engine spec](../specs/2026-09-30-capture-engine-design.md).

## Context

[The standards register](../agents/osint-investigation-standards.md) asks for a
transaction-level WARC (ISO 28500:2017) beside MHTML, because MHTML preserves a browser view and
is not an archival HTTP record.
[ADR-0034](0034-the-app-acquires-and-the-extension-is-a-companion.md) makes that record
obtainable: the capture engine can collect every request and response of a navigation when it
is attached before the first request.

A recording covers a browsing session, and a Capture covers one page. The record has to belong
to one of them. Web archiving tools store one archive per session and list pages inside it.
[ADR-0023](0023-exhibits-are-the-unit-of-evidence.md) makes the Exhibit the unit of evidence,
and [ADR-0009](0009-selection-exports-ship-the-full-manifest.md) lets an Operator export a
selection of Captures.

## Decision

**Each Capture carries its own Transaction Record.** When the Operator captures a page, the
engine writes a WARC holding that tab's current navigation, from its first request to the moment
of Capture: the document, its subresources, background requests, and anything Scroll-to-load
pulled in. The file is a primary artifact of the same Exhibit as the MHTML and the screenshot,
and the same Manifest Entry anchors its hash.

**Overlap is accepted.** Two Captures of one page taken without navigating hold overlapping
records. Each Capture stays complete without the other.

**The Manifest Entry inventories the artifacts.** It names which of MHTML, Transaction Record,
screenshot, and PDF are present and why any is absent. A Capture with no Transaction Record says
so; none is ever reconstructed afterwards. The inventory also accounts for every exchange a
Transaction Record lacks: one served from the cache, failed, cancelled, still in flight, or over
the size budget. The record is never described as complete beyond what the inventory supports.

**The record states what the browser reported.** Bodies arrive decoded and headers arrive
parsed, so a Transaction Record is the browser's account of the exchange. It is never described
as bytes read off the wire.

## Considered options

- **One WARC per Capture Session, as its own Exhibit, with Captures pointing into it.** Smaller
  on disk. Rejected: a Capture would no longer verify without a second file, an Exhibit Number
  would cover an hour of browsing, and a selection export would have to ship or slice a
  recording that holds pages the Operator did not select.

## Consequences

- Disk use grows, and repeated Captures of one page store the same responses more than once.
- The Capture definition changes from one format to a set of artifacts. A Firefox Capture has
  no MHTML, and the Content Hash is defined over a Capture's MHTML today, so what a Timestamp
  Token attests to for a Capture without MHTML needs its own decision before Firefox ships.
- Manifest Entry schemas are strict (`src/shared/schemas.ts`), so a verifier released before the
  new fields rejects an entry that carries them. The verifier learns the fields in a release
  before any build writes them, the sequencing ADR-0023 set.
- A WACZ export no longer needs a conversion from MHTML, which was the first question of the
  open spike #799. Its other questions stand, and no WACZ export is built until Transaction
  Records exist.
