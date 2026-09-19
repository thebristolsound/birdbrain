# Exhibits are the unit of evidence, and Captures are one kind of Exhibit

**Status:** Accepted

**Date:** 2026-08-30

A Case will hold evidence that is not a web page: files the investigator uploads (#45),
single images saved from a page with their EXIF data (#47), PDFs and other documents, and files
pulled from Google Drive. The model has one acquisition unit today, the Capture, and every
integrity mechanism (Content Hash, Manifest Entry, Trusted Time, Integrity Status, verification,
export) is written against it. The two parity tickets each proposed their own table, storage
directory, hash column and IPC domain, and neither mentioned the Manifest. Built as written they
would be two unanchored silos beside the chain, which #804 already identified as worse than not
storing the bytes at all.

**We decided** that an **Exhibit** is the unit of evidence, that a Capture is one kind of
Exhibit and is not renamed, and that every stored evidence file is either an Exhibit or a
**Derived File** computed from one. Every Exhibit has a `kind` (`capture`, `attachment`,
`image`, `document`, and later others) and an `origin` (`extension`, `background`, `duplicate`,
`import`, `manual-upload`, `extension-image`, `google-drive`),
orthogonal to each other, because a PDF can arrive by upload or by Drive and an image by
right-click or by a scrape. Every Derived File records what produced it: the parent Exhibit,
the derivation name, the tool version, and the time. That record is what lets an investigation
graph be reconstructed later (Maltego's Transform provenance, which its own documentation does
not persist) without adding Entity or Link tables now. An enrichment transform's output is a
Derived File whose derivation is named `transform:<name>`; transforms are derivations, never
origins, so one provenance model covers them (X42).

**Why one chain, not a hash column.** The Certification claims to describe the Case's evidence.
A document the investigator uploaded and the export ships is evidence to the recipient whether
or not the chain covers it, so the honest choices are to anchor it or to keep it out of the
package. This decision anchors it; ADR-0024 supplies the place where a file can exist before the
operator chooses to.

**The trade-off accepted.** The Manifest schema grows, the standalone verifier must learn the new
entry types before the first new kind ships, and every existing Capture gets an Exhibit Number
by a one-time migration. The alternative, per-kind tables with per-kind hashes, was rejected
because it makes the chain's completeness a property of which kinds a reader happens to know
about.

## Consequences

- **Two new Manifest Entry types, one shape each.** An `exhibit` entry with `kind`, `origin`, and
  `name` fields, for every Exhibit that is not a Capture; `capture` entries stay exactly as they are,
  `textHash` and `screenshotHash` included. A `derivation` entry for every Derived File of a new
  kind, whether computed at ingest or later, and for any later derivation on a Capture. It
  carries the parent Exhibit id and Content Hash, the derivation name and tool version, the
  output hash, path and time, and the operator. A Manifest Entry cannot be amended once written,
  which is why later derivations cannot ride in the parent's entry and get their own.
- **`deletion` and `timestamp` generalize** to any Exhibit id and Content Hash. Committing an
  Exhibit runs the same RFC 3161 path as ingesting a Capture, so Trusted Time is uniform across
  kinds.
- **`MANIFEST_SCHEMA_VERSION` becomes 3.** `ManifestEntrySchema` is a strict discriminated union,
  so a distributed verifier that meets an unknown `type` today reports the chain as broken. The
  verifier learns to report "entry type from a newer schema; verifier too old" as a distinct
  non-pass outcome, and that change ships in a release before any build writes a schema-3
  entry. Verifier copies distributed before that release still fail the strict parse and
  report a broken chain, and nothing can recall them; so the package README and the recipient
  runbook name the schema version a package needs and where the current verifier is, and the
  outcome is what every verifier from that release on reports. `CASE_ARCHIVE_SCHEMA_VERSION`
  takes its next number at merge (R16).
- **Storage.** Captures stay flat in `{caseId}/`. Each new kind gets its own subdirectory under
  the Case directory. Derived Files sit beside their parent with a suffix, as `_thumb.jpg` does
  today, and thumbnails join the anchored set.
- **Exhibit Numbers.** A sequential per-Case integer assigned at commit (at ingest for Captures),
  never reused, recorded in the Manifest Entry so a citation is verifiable. The next number is
  derived from the chain, one more than the highest any entry carries, deleted Exhibits included;
  a Capture's number rides on its own `capture` entry as an optional schema-3 field, amended in
  place before schema 3 first shipped (X45, X46, 2026-09-19). Existing Captures are
  numbered by Manifest index in a one-time migration that writes a `renumber` entry, so the
  assignment is itself in the chain. A legacy Capture with no Manifest Entry (pre-v11 `html`)
  is numbered after every anchored Capture, in capture order, and the `renumber` entry lists it
  as unanchored: the number is a citation aid and never an anchoring claim (X41). Display is "Exhibit 7"; any `EX-007` prefix is report
  rendering. Only Exhibits get numbers; a Derived File is cited by its parent and derivation.
- **Classification is Tags**, extended to every kind through an `exhibit_tags` relation that
  replaces `capture_tags` by migration. Sensitivity and access labels are deferred
  to the disclosure work on #543; the model reserves nothing for them.
- **Named but unbuilt.** `redaction` and `conversion` are derivations the model admits so a
  redacted PDF stays inside the chain when it arrives; building them, and choosing which variant
  an export ships, is later work that cites #543. Mentions over every Exhibit kind and an Exhibit
  index in the report are follow-up tickets; this decision names them as consumers only.
- **Exports follow the kind.** Evidence Packages, Working Copies, the standalone verifier, the
  report, and the Certification cover every kind and its Derived Files (`803e`). Until that
  lands, an Evidence Package export from a Case holding a committed non-Capture Exhibit is
  refused, never silently narrowed to Captures (X44).
- **First cuts per kind.** Manual upload is the first new route and is built inside #803's
  track; #45's implementation plan is replaced by this decision. Kind is permanent once
  anchored, so it is chosen at commit from the detected type: `document` for PDF, `image` for
  raster images, `attachment` otherwise; derivations for `document` and `image` arrive with
  their own tickets (X43). `image` arrives by
  right-click save (#47) with EXIF as a Derived File; scraping every image out of an MHTML is a
  later per-Case opt-in derivation. `document` derives text plus the PDF info dictionary and XMP
  in its first cut; update history, embedded files and active content are a second stage with
  its own tool ruling. Google Docs are exported by the operator and uploaded; `google-drive` is a
  second-phase origin whose Drive file id, revision and `modifiedTime` are recorded as claims from
  Google, with the app attesting only the bytes it received and when.
- **`CONTEXT.md`** carries Exhibit, Derived File, Derivation, Exhibit Number, and Staging Pool.
  `artifact` stays avoided.

The rulings behind each consequence are in
`docs/plans/2026-08-30-exhibit-model-rulings.md`.
