# A link Capture records the Capture it came from

**Status:** Proposed

**Date:** 2026-10-04

The maintainer ruled on the questions this record settles on 2026-10-04. Nothing in it is
implemented. The work is planned in
[the slice 2 plan](../plans/2026-10-04-mhtml-viewer-slice-2-click-through-and-provenance.md),
Part B.

## Context

The stored-page viewer lets the Operator right-click a link in a stored page and choose Capture
link (PR #1709). The link is queued as an ordinary background Capture into the same Case. The new
Capture's Manifest Entry records what any background Capture of that URL records, and nothing
about the page that held the link.

Two facts are lost:

- **Which page the Operator followed.** An investigator who captures the pages a profile links to
  cannot later show, from the chain, that each one was reached from that profile.
- **Which address the page named.** A background Capture is stored under the URL the bytes came
  from. On a redirect, the acquiring path writes that final URL as both `url` and `finalUrl`, so
  no field holds the address that was requested. For a link Capture, the requested address is
  the link's own.

Shared Cases keep one signed chain per member
([the collaborative cases design](../specs/2026-09-19-collaborative-cases-design.md), decision 1),
and members see each other's Exhibits. A member can therefore capture a link from a page that
another member's chain anchors, where the new entry's own chain cannot resolve the source by id.

## Decision

**A Capture made with Capture link records its source in its signed `capture` entry.** Three
optional fields, written only by a Capture link job and omitted from every other entry, so every
existing canonical body and chain hash is unchanged:

- `linkedFromCaptureId`: the id of the Capture whose stored page held the link.
- `linkedFromContentHash`: that Capture's Content Hash, so the reference binds the source's bytes
  even when the source is anchored in another member's chain.
- `linkHref`: the link's address as the viewer read it from the stored page, which is the
  address the background render was sent to.

**What the record claims.** The Operator chose Capture link on a link in the source Capture, and
the link named that address. It does not claim that the source still links there, that the
destination served the same page when the source was captured, or that the Operator read the
source first. The source's stored bytes are the evidence that it held the link, and reading the
links out of its MHTML again shows it.

**The method stays `background`.** The acquisition path is the same queue and renderer, so
`CAPTURE_METHODS` gains no value. A link Capture observed its destination afresh: it is a new
sighting, unlike a Duplicate.

**The fields need schema 5.** `ManifestCaptureEntrySchema` is strict, so a verifier that does not
know the fields would read an entry carrying them as a broken chain. The fields are valid only on
an entry whose `schemaVersion` is at least 5, the rule `exhibitNumber` follows at 3, so a schema-4
verifier reports "verifier too old". They join the first verifier release that teaches schema 5,
which the chain-head anchoring design also needs; if none is in flight when this work is ready,
this work takes 5 and the next takes 6. That release ships before any build writes the fields, as
[ADR-0023](0023-exhibits-are-the-unit-of-evidence.md) requires.

## Considered options

- **Record the id only, as `supersedesCaptureId` and `duplicateOfCaptureId` do.** Rejected because
  of Shared Cases: in a single-owner Case the id resolves to the source's entry in the same chain,
  and [ADR-0009](0009-selection-exports-ship-the-full-manifest.md) ships that entry even in a
  selection export, but another member's source is in another chain.
- **Record the frame that held the link.** Electron's `context-menu` parameters carry the frame's
  URL, and a Links tab row carries its document URL. A link in an embedded advertising frame is a
  weaker connection than one in the article. Rejected for the Manifest: the viewer shows the frame,
  and the source's stored bytes show it to anyone who reads them.
- **A new Capture method, `link`.** Rejected: the method names an acquisition path, and this path
  is the background renderer.

## Consequences

- The `captures` table gains `linked_from_capture_id`, `linked_from_content_hash` and `link_href`
  by migration, so the viewer can show "From a link in" beside the existing Duplicate and
  Recapture links, and the report can print the rows.
- The recapture queue checks in the main process that the source exists and is in the job's Case
  before it accepts a link job.
- A Recapture of a link Capture does not inherit the fields. It records its own
  `supersedesCaptureId`.
- A Capture of a Wayback snapshot of a link (the slice 3 plan) does not carry the fields: the
  snapshot's address is not the address the page linked to.
- `CONTEXT.md` gains a relationship line beside the Recapture and Duplicate ones when this record
  is accepted.
