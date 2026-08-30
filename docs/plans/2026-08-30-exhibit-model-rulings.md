# Exhibit model rulings

Ruled 2026-08-29 and 2026-08-30 in an interactive grilling of #803 that re-rooted the ticket. The
first round treated #803 as a browser over today's three files per Capture; the maintainer
redirected it to the content model the mock was drawn for (attachments, images with EXIF, PDF
ingestion, Google Docs import, and Maltego-class depth), and the rounds below settled that
model. The decisions are recorded as ADR-0023 (the Exhibit model) and ADR-0024 (the Staging
Pool); this document is the trail of what was asked, what was answered, and on what grounds.

Numbered X1-X32 to keep them distinct from wave 3's R1-R23 and wave 4's W1-W26, which still
bind where they do not conflict. Where a ruling below contradicts an earlier ruling, the later
one wins and the conflict is named. Rulings X28-X32 were taken by the agent under ADR-0015 and
are open to veto.

## Round 2: the model

**X1 (R1) - the model comes first.** One ADR pair plus glossary entries before `803a` is built,
with Captures as the only populated kind and no attachment or image code in #803. Grounds: the
inventory read path is the model's first consumer, and a per-Capture inventory built now is
rebuilt when the second kind arrives, at the cost of a second blocking-tier review.

**X2 (R2, amended by X12-X16) - only explicitly committed files enter the chain.** The
maintainer rejected anchor-on-arrival and described a per-Case staging pool: content sits in a
pool and only committed files are ingested and attached to the chain. Round 3 shaped the pool.

**X3 (R3) - raw versus derived is the primary axis, and Derived Files are anchored.** Every
stored file is an Exhibit or a Derived File; a Derived File carries its parent and its
Derivation. Grounds: Selectors and Extracted Data run over derived text, and a match that cannot
be tied to bytes the chain covers is not evidence of anything.

**X4 (R4) - per-kind subdirectories for new kinds; Captures stay flat.** Derived Files sit beside
their parent with a suffix, as `_thumb.jpg` does. Grounds: a per-item directory is a migration
of every existing Case for no verifier gain; a flat directory with kind only in the database
loses the layout `parseArtifactFilename` relies on.

**X5 (R5) - Google Docs phase 1 is export-and-upload.** The operator exports the Doc and uploads
it as a document with origin `manual-upload` and the source URL as a stated, unverified claim.
The maintainer noted a user wants a Drive integration; see X26.

**X6 (R6) - the first derivations of a PDF are text and metadata.** No page thumbnails. The maintainer
wants full forensic PDF tooling eventually; see X27. The parser choice is a separate dependency
ruling.

**X7 (R7) - right-click image save first.** One image, operator-witnessed, origin
`extension-image`, EXIF parsed at ingest into an anchored Derived File. Scraping every image out
of an MHTML is a later per-Case opt-in derivation over existing Captures. Grounds: scrape-all
multiplies stored files by two orders of magnitude while the MHTML already holds the bytes.

**X8 (R8) - the Data screen is the inventory and integrity cross-cut over every kind.** Kinds with
a rich interaction model keep their own surface (the image gallery); attachments and documents
live in Data only, with upload as an action there.

**X9 (R9) - the term is Exhibit, with Derived File.** A Capture is an Exhibit and is not renamed.
Grounds: `reportHtml.ts` already renders per-exhibit blocks, and it is the word the
Certification's readers use. The maintainer's note supplied an attribute list (identity,
human-readable reference, media and storage fields, metadata, classification, citations, index,
derivative processing, immutability, permission scoping); round 3 took each in turn.

**X10 (R11) - graph-reconstructable, not graph-native.** Every Derived File and Extracted Datum
records what produced it; no Entity or Link tables; the Link Map stays a projection. Enrichment
becomes a future origin `transform:<name>` whose outputs are anchored Derived Files. Grounds: the
2026-08-12 Maltego research (`docs/specs/2026-08-12-maltego-graph-node-research.md`) shows
Maltego's depth is Entities with merge rules, first-class links, Transforms and Machines, and its
documented gap is provenance; a graph-native model now is a second product.

**X11 (R10) - round 1 is provisional.** The twelve #803 questions of 2026-08-29 are re-asked
against the ADRs, shorter, before `803a` dispatches.

## Round 3: the pool, derivations, and the maintainer's notes

**X12 (S1) - the pool is `{caseId}/staging/` and travels.** In the `.birdbrain` archive as
declared entries flagged `staged`; never in an Evidence Package; in a Working Copy by opt-in.
Grounds: the archive rejects undeclared zip entries (`caseArchive.ts:273-285`), so a pooled file
can travel only as a declared entry; an investigator moving a Case expects working material to
come along.

**X13 (S2) - pooled files are write-once and hashed on arrival.** Shown as "not anchored";
editing means pooling a new file; commit re-hashes and refuses changed bytes.

**X14 (S3) - Captures and archive imports commit directly; everything new pools.** Manual
uploads, right-click image saves, document imports, Drive imports, any future scrape-all.

**X15 (S4) - derivations run in the pool; matches and Extracted Data are recorded at commit.**
Pooled text is searchable in the pool view only.

**X16 (S5) - a Staging group in the Data screen.** Rows carry a "not anchored" chip, are excluded
from Integrity Exceptions and the Manifest Ledger, and offer Commit and Discard inline and in
the context menu. Upload lands in Staging. The inventory channel returns pooled and anchored rows
with a discriminator.

**X17 (D1) - a `derivation` Manifest Entry for every derivation on a new kind, at ingest or
later, and for any later derivation on a Capture.** Captures keep `textHash` and
`screenshotHash` for compatibility. Grounds: an entry cannot be amended once written, so a
derivation that runs after its parent's ingest has nowhere in that entry to be anchored; one
shape for every derivation is what makes X10 hold.

**X18 (E1) - Exhibit Numbers are sequential per Case, assigned at commit, never reused, and
recorded in the entry.** Existing Captures are numbered by Manifest index in a one-time
migration that writes a `renumber` entry. Grounds: a reference that changes between two exports
of the same Case is worse than none.

**X19 (E2) - classification is Tags; sensitivity is deferred to #543.** No separate category
enum. Grounds: a second classification mechanism beside Tags is the collision W6 just ruled
against for session state.

**X20 (E3) - Mentions over every Exhibit kind and a report Exhibit index are follow-up
tickets.** The ADR names them as consumers only.

**X21 (E4) - `redaction` and `conversion` are named derivations with no implementation.** Export
variant selection is a later ticket that cites #543.

**X22 (G1) - Google Drive is a phase-2 origin, filed now as a spec ticket.** After the manual
route and the pool exist; files land in the pool; the entry records the Drive file id, revision
id and `modifiedTime` as claims from Google, and the app attests only the bytes it received and
when. Grounds: an authorization flow against Google, a dependency, and an external call on the evidence path are three
maintainer rulings; the pool is what makes a bulk pull safe.

**X23 (P1) - PDF forensics in two stages.** Stage 1 with the text parser: info dictionary and XMP
as one anchored `pdf-metadata` Derived File. Stage 2, its own ticket: incremental-update history,
embedded files and active content, with the external-tool choice (`qpdf`, `exiftool`, `pdfid`)
ruled separately. Both are `derivation` entries, so stage 2 runs on PDFs committed earlier.

## Round 4: consequences

**X24 (T1) - one `exhibit` entry type with `kind` and `origin` fields.** Not one type per kind.
`capture` entries stay as they are. Grounds: the verifier learns one shape, and origin stays
orthogonal to kind.

**X25 (T2) - `MANIFEST_SCHEMA_VERSION` becomes 3, and a stale verifier reports that it is too old,
never a tamper verdict.** The verifier change ships before or with the first new type.
Grounds: `ManifestEntrySchema` is a strict discriminated union, so an unknown `type` fails the
parse today, and "chain broken" from a stale verifier is a false accusation in front of a
recipient.

**X26 (T3) - committed Exhibits get Trusted Time.** Commit runs the same RFC 3161 path as ingest;
the `timestamp` entry generalizes to any anchored Content Hash. Grounds: for an uploaded document
the commit moment is the one that matters, and an uneven Trusted Time axis would make the
Certification's time claims uneven.

**X27 (T4) - #803 absorbs the pool and manual upload.** The model tickets replace #45's
implementation plan; #803's track gains the pool plus upload as the first pooled kind
(`attachment`); #45 closes into the model tickets once they exist; #47 stays its own feature over
the model. Grounds: an empty Staging group is a placeholder, which the ticket forbids, and upload
is the smallest pooled kind.

## Decisions the agent took

**X28 - two ADRs, not one.** 0023 for the model, 0024 for the pool, so either can be vetoed alone.
Placement class.

**X29 - `deletion` generalizes to any Exhibit; discard from the pool writes nothing.** Follows
from X2 and X12: the pool is outside the chain.

**X30 - `CASE_ARCHIVE_SCHEMA_VERSION` takes its next number at merge** with the `staged` flag and
the new kinds (R16 pattern).

**X31 - only Exhibits get numbers.** A Derived File is cited by its parent reference and
derivation name.

**X32 - display is "Exhibit 7" from a stored integer.** Any `EX-007` prefix is report rendering,
not model data.

## What this changes on the tracker

- **#803.** The 2026-08-27 a-d split is superseded; that draft also restated claims R21 had
  already corrected (tree row heights, "tree search"). `ready-for-agent` was removed from the
  parent on 2026-08-30 per R6. `803a` becomes the inventory and pool read path over the model
  with Captures and attachments populated; the browser parts follow; the round-1 questions are
  re-asked (X11).
- **#45** closes into the model tickets once they exist (X27). **#47** builds over the model
  (X7). **#804** and **#991** stay separate and cite ADR-0023. **W4** (snapshot rows on the Data
  screen) is retracted: pinned Wayback refs store no bytes, so there is no Exhibit for the menu
  to attach to; the kind stays unowned and is recorded on #708.
- **New:** a `ready-for-human` spec ticket for the Google Drive origin (X22); a small docs ticket
  for the Vale debt in the two committed Maltego research documents.

## Outstanding

Nothing gates the ADRs. The #405 site list and the #985 ruling remain owed from the round-2
plan and are unrelated to this model.
