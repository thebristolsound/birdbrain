# Exhibit model rulings

Ruled 2026-08-29 and 2026-08-30 in an interactive grilling of #803 that re-rooted the ticket. The
first round treated #803 as a browser over today's three files per Capture; the maintainer
redirected it to the content model the mock was drawn for (attachments, images with EXIF, PDF
ingestion, Google Docs import, and Maltego-class depth), and the rounds below settled that
model. The decisions are recorded as ADR-0023 (the Exhibit model) and ADR-0024 (the Staging
Pool); this document is the trail of what was asked, what was answered, and on what grounds.

Numbered X1-X51 to keep them distinct from wave 3's R1-R23 and wave 4's W1-W26, which still
bind where they do not conflict. Where a ruling below contradicts an earlier ruling, the later
one wins and the conflict is named. Rulings X28-X32 and X41-X44 were taken by the agent under ADR-0015 and
are open to veto. Round 5 is the X11 re-ask of the 2026-08-29 round-1 questions, held on
2026-08-30 after the ADRs were written. Round 7 (X45-X50) was ruled by the maintainer on
2026-09-19 in the triage of the numbering defects; round 8 (X51) records the menu ruling of
2026-09-18, first recorded as X45.

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
outputs are anchored Derived Files whose derivation is named `transform:<name>` (amended by X42). Grounds: the
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

## Round 5: the round-1 questions, re-asked against the ADRs

Five round-1 questions were settled by the ADRs and were listed for veto rather than re-asked;
none was vetoed. Q1 (purpose) is X8. Q8 (search) is R21: name, Exhibit, kind, and hash only, no
page text. Q9 (Wayback rows) is the W4 retraction. Q10 (Properties tab) is recorded size carrying the
recorded-at-ingest label, no Remote address, the real relative path, Collector from the four version
fields, plus kind, origin, and Exhibit Number, and for a Derived File its parent and derivation.
Q12 (Reprocess) stays inside the Indicators view header with whole-case semantics and no per-file
re-extract.

**X33 (Q2 restated) - the tree groups Data Sources by kind, and Derived Files are child rows of
their Exhibit.** One subgroup per kind (Captures and Attachments first; Images and Documents when
their kind ships), one node per Exhibit, no `raw` or `derived` folders. Staging is its own
top-level group beside Data Sources; Views and Results stay. Grounds: per-kind subgroups mirror
the storage layout (X4), and the per-kind count is the first thing an operator asks for.

**X34 (new) - legacy thumbnails are regenerated and anchored by the migration.** The migration
regenerates each thumbnail from its anchored screenshot and writes a `derivation` entry dated at
migration, with the migration as the tool. A Capture whose screenshot is missing or fails
verification gets no entry, and its thumbnail row carries the not-anchored label. Grounds: hashing the
bytes found on disk would anchor a swapped file, and leaving legacy thumbnails unanchored leaves a
permanent two-class inventory.

**X35 (new) - schema shape.** A new `exhibits` table is the identity and numbering row (id, Case,
kind, origin, Exhibit Number, name, Content Hash, path, size, committed time, and Manifest
sequence); `name` is the original or display name, recorded, never derived from the path.
Captures keep the `captures` table and get an `exhibits` row with the same id, written by the
`renumber` migration. A `derived_files` table (parent, derivation, tool version, hash, path, and
time) holds Derived Files; `textHash` and `screenshotHash` stay on `captures`. Pooled files live
in a `staging_files` table, with the same `name` column, and never in `exhibits`. An
`exhibit_tags` relation replaces `capture_tags` by migration so Tags reach every kind. Grounds: kind and origin columns on
`captures` would make every Capture column nullable for the kinds that lack it, and the
inventory query would become a per-kind special case.

**X36 (Q4 restated) - one `manifest:snapshot(caseId)` channel.** It returns the parsed entries
typed by the schema-3 union (`exhibit`, `derivation`, and `renumber` added to the six), the
`verifyManifestChain` verdict, and one signer fingerprint per signing segment: an imported
Case's chain is verified with the embedded source key before each `import` boundary and the
local key after it, so a single fingerprint would describe it wrongly. The renderer never computes
chain state.

**X37 (Q5 restated) - three integrity buckets over every anchored row, with a verify-all
action.** Verified; tampered, missing, or chain-broken; and unverified, over Exhibits and Derived
Files alike, with `Verify all` running a per-Exhibit verify in sequence. Verify for a kind lands
with the kind: the model ticket carries `exhibits:verify` delegating to the existing Capture path,
and the pool ticket extends it to attachments. Pooled rows are excluded (X16).

**X38 (Q6 restated, amended by X51) - backed menu items only, plus the pool actions.** Exhibit or Derived File
row: `Open in viewer`, `Copy SHA-256`, `Copy relative path`, `Verify`. Node: Show only this, Expand or
Collapse below, Verify. Ledger entry: Show target, Copy entry hash, Copy previous hash. Staged
row: `Commit`, `Discard` (confirmed), and `Copy SHA-256` carrying the not-anchored label. Group
action: `Upload`.
The `shell:showItemInFolder` allowlist is not widened; that stays a separate security ruling.

**X39 (Q7 restated) - Results nodes.** Keyword Hits has one child per Selector and filters the
table to matched Exhibits with no snippet; the Extracted Text node becomes "Indicators" (R21's
view); nothing from pooled content appears (X15).

**X40 (Q11 restated, amended by X44) - seven sub-tickets.** `803v` verifier and schema 3 (entry types, the
"verifier too old" outcome, generalized `deletion` and `timestamp`, KATs), first and alone.
`803a` model and read path (the X35 tables, the `renumber` and thumbnail migrations,
`exhibits:inventory` with the pooled/anchored discriminator, `manifest:snapshot`,
`exhibits:verify`), with Captures the only populated kind. `803p` the Staging Pool (storage,
upload as `attachment`, commit, discard, the archive `staged` flag, verify for attachments).
`803b` shell, tree, table, search, and the Staging group. `803c` tabs, Results nodes, the
Indicators move, and Reprocess. `803d` menus. `803e` exports, verifier, report, and
Certification over every kind (X44). All blocking tier; `803p` may run beside `803b`.
Grounds: a schema-3 chain must not exist before distributed verifiers can read it, which is the
case for `803v` alone, and the pool beside the model makes `803a` one review too large to hold.

## Round 6: review of PR #1145

Codex reviewed the ADR pull request on 2026-08-30 and found four model gaps and three wording
gaps. The wording gaps (stale distributed verifiers, archive imports of `staged` entries, the
`name` column, the per-segment signer, Exhibit-wide Tags) are corrected in place above and in
the ADRs. The four gaps below needed a decision; each was taken under ADR-0015 as pattern
following or mechanical sequencing and is open to veto.

**X41 - legacy Captures without a Manifest Entry.** Pre-v11 `html` Captures have no
`manifestIndex` (`captureLifecycle.ts:336-337`). They are numbered after every anchored
Capture, in capture order, and the `renumber` entry lists them as unanchored; the number is a
citation aid and never an anchoring claim, and the inventory shows those rows unanchored.

**X42 - transforms are derivations, not origins.** A transform's output is a Derived File whose
derivation is named `transform:<name>`; `transform:<name>` leaves the origin list. Amends X10.
Grounds: one provenance model, and the X35 tables cannot carry an origin on a Derived File.

**X43 - kind is chosen at commit from the detected type.** `document` for PDF, `image` for
raster images, `attachment` otherwise, because kind is permanent once anchored and a PDF
committed as `attachment` would have to be reclassified against its own entry. Derivations for
`document` and `image` arrive with their tickets; in `803p` those kinds commit with no Derived
Files.

**X44 - a seventh sub-ticket, `803e`, owns exports over every kind.** Evidence Packages,
Working Copies, the standalone verifier, the report, and the Certification enumerate Captures
only today. `803e` extends them to every Exhibit kind and its Derived Files; until it lands,
`803p` refuses an Evidence Package export from a Case holding a committed non-Capture Exhibit,
naming the ticket. Grounds: ADR-0023 chose to anchor rather than to keep evidence out of the
package, and a silent omission would be the dishonest third option.

The `CONTEXT.md` finding (mark Derived File anchoring as planned) was not applied: the glossary
defines the model and carries no implementation state; the ADR's consequences and X34 carry the
transition.

## Round 7: numbering integrity (2026-09-19)

Ruled in a triage grilling of the five numbering defects the exhibit-chain reviews filed
(#1270, #1278, #1279, #1284, #1332), after `803a`-`803d` had merged and before `803e`. Every
recommendation below was accepted by the maintainer as put.

**X45 - the next Exhibit Number derives from the Manifest chain.** The next number is one more
than the highest `exhibitNumber` carried by any entry in the Case's chain, deleted Exhibits
included, since a deletion appends and never removes. No high-water column or counter table;
a database cache may be added only if a commit on a large Case measures slow, and the chain
wins on disagreement. Grounds: X18 makes the chain the citation authority, and an imported
chain carries the mark across an archive round trip with no extra payload. Supersedes the
`MAX + 1` read over live rows.

**X46 - the `capture` entry carries `exhibitNumber`, and schema 3 is amended in place.** Every
Capture ingested after the one-time backfill records its number on its own `capture` entry,
the entry that anchors the bytes. The field is optional in the schema so entries written by
builds before this ruling still parse. No schema 4: no released verifier reads schema 3 yet,
so amending it costs a recipient nothing, and ADR-0023 is amended by one line. `renumber`
stays the one-time legacy assignment. Grounds: X18 says "recorded in the entry"; a second
entry per Capture or a per-ingest `renumber` would make one of the existing types mean two
things. Every entry schema is strict, so the field had to be a schema decision and not a free
addition.

**X47 - no signing path writes an entry without an operator name.** The backfill, Capture
deletion, and the Staging Pool commit join ingest, duplicate, import, and export in refusing
with `operator_name_required`. The backfill skips a Case it cannot sign for and re-runs when
the name is saved in Settings, not only at the next launch; the Data screen shows the skipped
rows as unnumbered with that reason. Grounds: a placeholder is a signed claim that nobody made
the entry. Accepted consequence: with no name set, a deletion is refused too.

**X48 - a repeated Exhibit Number is an Integrity Exception, never tamper.** Two anchoring
entries in one chain carrying the same `exhibitNumber` is a verifier rule from this build on,
reported as an exception. Existing rows that were reissued a number under the `MAX + 1` read
keep it; no migration rewrites a number that has been visible on the Data screen. Grounds:
X18 forbids the rewrite, and the rule is a true invariant once X45 holds.

**X49 - import readers resolve copied entries through the on-disk id map.** An import remaps
an id only on collision and writes the full map beside the chain, anchored by the `import`
entry's `idMapSha256`. Readers of a copied `renumber` (and of any copied entry naming a
remapped id) resolve through that map; import never appends a corrective `renumber`, and the
imported chain stays verbatim so the source signer's entries remain verifiable. #1278's
remainder is the Exhibit-id case of #1472 and is blocked by it.

**X50 - the schema-3 reader and writers ship in the same first public beta.** No tag holds
the reader, so a verifier-only release first would help no recipient; the package README and
`VERIFY.md` name the required verifier version (#1172 owns the wording), and #1284 closes at
the tag. Grounds: the reader-before-writer ordering of X25 protects holders of an older
released verifier, and none holds a schema-3 package.

## Round 8: the menus as shipped

Ruled 2026-09-18 by the maintainer after #1471 landed X38 and every tree node, group head
and ledger entry had grown a menu. Recorded on `main` as X45; renumbered X51 on 2026-09-30
because the numbering rulings of 2026-09-19 were recorded as X45-X50 on a branch that reached
`main` later, and code and tickets already cite them by those numbers.

**X51 - a menu only where a row has a real action.** A context menu mounts only on an element
that reads as clickable, and only when it offers an action beyond the click and a copy. On the
tree that is a row node with a subtree to expand or Exhibits to verify; group heads are
eyebrows and get none, and a Derived File node or the Manifest Ledger node has nothing to
offer. A Manifest Ledger entry gets no menu: Show target is the row click and the two hash
copies are the cells, so the `ledger` kind leaves the registry. Exhibit, Derived File and
pooled rows keep theirs. An item a node cannot take is left out, not greyed. Amends X38's
node and ledger lists; the Exhibit, staged, and group action lists stand. Grounds: a menu that
repeats the click, or holds nothing but Copy SHA-256, is noise, and the maintainer's original
"every node" ask was wider than intended.

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
  for the Vale debt in the two committed Maltego research documents; `803e` (X44).

## Outstanding

Nothing gates the ADRs, and nothing gates the six sub-tickets except the ADRs landing on `main`. The #405 site list and the #985 ruling remain owed from the round-2
plan and are unrelated to this model.
