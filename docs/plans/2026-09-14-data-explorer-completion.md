# Data screen completion: #1149, #1148, #1150, #1151

Working notes for the four open sub-tickets of the exhibit-model map (#803). Written
2026-09-14 in an interactive session; the rulings in
`docs/plans/2026-08-30-exhibit-model-rulings.md` (X1-X44) and the ticket bodies bind, and
where this plan and a ruling differ the ruling wins.

## Where the chain stands

- #1146 (`803v`, schema 3) and #1147 (`803a`, tables and read channels) are merged. The
  renderer calls none of the new channels yet; `DataExplorer.tsx` is still the extracted-data
  drill-down.
- The four open tickets and their native order: #1149 (`803b`) and #1148 (`803p`) can start
  now; #1150 (`803c`) waits on #1149; #1151 (`803d`) waits on #1149 and #1148.
- Every one is `evidence-affecting` at the blocking tier: human review, no auto-merge.

## Order of work and pull requests

One branch per ticket, stacked in dependency order, one pull request per ticket:

1. `data/1149-shell` from `main`.
2. `data/1148-staging-pool` from `main`.
3. `data/1150-tabs-results` from `data/1149-shell`.
4. `data/1151-context-menus` from `data/1150-tabs-results` with `data/1148-staging-pool`
   merged in.

Each PR is opened against its base branch and retargets to `main` as its predecessor merges.
Each carries its own `pnpm preflight` block at head.

## Decisions taken in this plan (ADR-0015, open to veto)

- **MHTML Parts tab is absent.** #1150 lists it, but #991 owns the MIME-walker and part-hash
  rulings, was deferred by the maintainer on 2026-08-30, and is closed as stale. A tab with no
  data is absent, not empty (#1150), so the strip carries four tabs and the PR body names #991.
- **SOURCE column.** A Capture row shows its URL host; a Derived File row shows its parent
  Exhibit's name; a pooled or non-Capture row shows its origin. The mock's column held the
  capture id, which the NAME column already carries for a Capture.
- **`legacy` verification status** buckets as unverified in Integrity Exceptions (X37 names
  three buckets and a legacy Capture has no entry to verify against); the row is labelled
  unanchored.
- **Derived File verification.** `exhibits:verify` grows a `derived` list: each anchored
  Derived File of the Exhibit is re-hashed against its recorded hash and reported as
  `verified`, `tampered` or `missing`. An unanchored Derived File is reported `unverified`
  and never re-hashed, because a hash the chain does not cover proves nothing.
- **Trusted Time for committed Exhibits (X26) with no migration.** The timestamp worker gains
  `stampExhibit`; pending non-Capture Exhibits are found from the manifest (an anchored
  non-Capture Exhibit whose Content Hash has no `timestamp` entry) rather than from a mirror
  column, so `exhibits` gains no column and the queue survives a lost mirror by construction.
- **#1180 in the writer.** `appendManifestEntry` and `withManifestEntry` take an optional
  `minReaderSchemaVersion`; the commit path passes 3 on the `timestamp` entry it requests for
  a non-Capture Exhibit. No deletion path for non-Capture Exhibits exists yet (#1151 excludes
  Delete), so the deletion half has no caller and is covered by the same option.
- **Export guard scope (X44).** The Evidence Package (`format: 'zip'`, `exportClass:
  'evidence'`) is refused while the Case holds a committed non-Capture Exhibit. The HTML and
  PDF reports and the Working Copy are unchanged; #1156 lifts the refusal.
- **Archive schema bump (X30).** `CASE_ARCHIVE_SCHEMA_VERSION` goes to 6. `data.json` gains
  `exhibits` and `stagingFiles`; the zip gains `files/<kind-dir>/<id><ext>` for committed
  non-Capture Exhibits and `files/staging/<id><ext>` entries whose artifact record is flagged
  `staged`. Import inserts the `exhibits` rows from the payload, which closes the
  exhibit-number round-trip gap `exhibitRepo.ts` records. `derived_files` rows do not travel:
  thumbnails are regenerated and re-anchored by the backfill, and no other derivation exists.
- **Verification state for non-Capture Exhibits is session-only.** `captures` persists
  `last_verified_*`; `exhibits` does not, and adding the columns is a migration this plan
  avoids. An attachment reads as unverified on open until Verify runs.
- **Evidence path list.** `src/main/services/exhibits.ts`, the new
  `src/main/services/staging.ts` and `src/renderer/components/data/**` are added to the
  blocking tier table in `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` by the
  PR that creates each.

## #1149 (`803b`): shell, tree, table, search, Staging group

**Renderer.**

- `src/renderer/lib/api/exhibits.ts`: `exhibitInventoryQueryOptions(caseId)`,
  `manifestSnapshotQueryOptions(caseId)`, `useExhibitsMutations(caseId)` (verify, with
  inventory invalidation). `keys.ts` gains `exhibitInventory`, `manifestSnapshot`,
  `exhibitVerification`.
- `src/renderer/components/data/`: `dataTreeModel.ts` (pure: inventory -> four groups with
  counts; X33), `dataTableModel.ts` (pure: node -> rows, search over name, Exhibit Number,
  kind, hash; R21/Q8), `DataTree.tsx` (`var(--d-tree)` rows), `ArtifactTable.tsx` (NAME,
  SOURCE, KIND, SIZE, SHA-256, CAPTURED; missing-on-disk state; not-anchored chip),
  `StagingGroup.tsx` (Upload group action; inline Commit and Discard wired to the `803p`
  channels, inactive until they exist), `ArtifactTabs.tsx` (strip with Properties only),
  `PropertiesTab.tsx` (kind, origin, Exhibit Number, recorded size labelled "recorded at
  ingest", relative path, Collector from the four version fields; parent and derivation for a
  Derived File).
- `DataExplorer.tsx` becomes the shell: rail, main pane, tab strip. The current body moves to
  `src/renderer/components/data/IndicatorsView.tsx` unchanged and is reachable as the
  Results > Indicators node so the IOC browser survives (R21).
- `tests/components/DataExplorer.test.tsx` rewritten; existing indicator tests move to
  `IndicatorsView.test.tsx`; `tests/renderer/components/dataTreeModel.test.ts` and
  `dataTableModel.test.ts`; `tests/renderer/api/exhibits.test.ts`.
- `e2e/readme-screenshots.spec.ts` selects the Indicators node before waiting for the
  extraction text.

## #1148 (`803p`): Staging Pool

**Main.**

- `src/main/services/staging.ts`: `uploadToStaging(caseId, filePaths)`,
  `commitStagedFiles(caseId, ids)`, `discardStagedFiles(caseId, ids)`, `detectExhibitKind`
  (magic bytes: `%PDF-` -> `document`; PNG, JPEG, GIF, WebP, BMP, TIFF -> `image`; else
  `attachment`; X43). Upload streams each file into `{caseId}/staging/{id}{ext}` under
  `MAX_MHTML_SIZE`, hashes on arrival, inserts the `staging_files` row with
  `origin = 'manual-upload'`. Commit re-hashes and refuses on change (X13), moves the file
  into the kind's subdirectory, then per file inside `withManifestEntry` writes one `exhibit`
  entry (X24), inserts the `exhibits` row with the next number and the entry index, deletes the
  staging row in one transaction, and queues the RFC 3161 request (X26). Discard removes the file and
  deletes the row and writes nothing (X29).
- `manifest.ts`: `ManifestEntryInput` gains the `exhibit` variant;
  `MIN_READER_SCHEMA_VERSION.exhibit = 3`; the `minReaderSchemaVersion` option.
- `timestampWorker.ts`: `stampExhibit(exhibitId)`; `processPending` also walks pending
  non-Capture Exhibits.
- `exhibits.ts`: `verifyExhibit` handles every non-Capture kind (hash the file, compare with
  the row and the chain entry, report the Capture statuses) and the `derived` list.
- `export.ts`: the X44 refusal before any file is written, naming #1156.
- `caseArchive.ts`: schema 6 as stated in the decisions; `inspectCaseArchive` verifies staged entries by hash
  like any artifact; import restores them to the pool and never as anchored (X12).
- IPC: `staging:upload(caseId)`, `staging:commit(caseId, ids)`, `staging:discard(caseId,
  ids)` in `ipc.ts`, `birdbrainApi.ts`, `preload/index.ts`, `ipcHandlers.ts` (the open dialog
  lives in the handler, as the archive import does), `tests/renderer/fakeBridge.ts`.
- Tests: `tests/main/services/staging.test.ts` KATs (upload row and hash with no manifest
  write; commit entry shape and `schemaVersion: 3`; the timestamp entry for an attachment at
  3 and for a Capture at 2; refuse-on-change; discard writes nothing; verify tampered
  attachment; kind detection for PDF, PNG, zip; export refusal; archive round trip);
  `tests/main/ipcHandlers.test.ts` for the three channels and dialog cancel.

## #1150 (`803c`): tabs, Results nodes, Indicators, Reprocess

- `ExtractedTextTab.tsx` (the `.txt` sidecar through `captures.getContent`, highlight from
  the selected Keyword Hit), `HeadersTlsTab.tsx` (`Capture.headers` and `tlsCertChain`, the
  `ForensicsTab` shapes), `ManifestLedgerTab.tsx` (entries naming the Exhibit, from the
  snapshot). A tab absent for kinds without the data.
- Results nodes: `KeywordHitsNode` (one child per Selector from `selectorsQueryOptions` and
  `listMatchingCaptureIds`; filters the table; no snippet; X39), `IndicatorsView` with
  Reprocess in its header (Q12), `IntegrityExceptionsView.tsx` (three buckets over anchored
  rows; node count is the exceptions count; Verify all runs `exhibits:verify` per Exhibit in
  sequence with progress; X37), `ManifestLedgerView.tsx` (every entry typed by the nine
  types, the verdict and signer fingerprints from the snapshot, `unsupported` rendered as
  verifier too old and never as tampering; X25, X36).
- `src/renderer/lib/api/exhibits.ts` gains `useVerifyAll`.
- Tests per node and tab, including the too-old verdict and the sequential verify-all.

## #1151 (`803d`): context menus

- `entityMenu.ts` gains `exhibit`, `node`, `ledger` and `staged` kinds with exactly the X38
  items; `entityMenuHeader` cases; `useDataContextMenu.ts` builds targets from the same
  mutations the inline routes use. Every item has an inline or keyboard route; none calls
  `shell:showItemInFolder` (#1194 is open).
- Discard confirms through a dialog shared with the inline button.
- Tests: `entityMenu.test.tsx` additions; `DataExplorerContextMenu.test.tsx`.

## ADR-0004 obligations, per PR

Evidence impact section stating what the screen makes visible and what it does not claim:
session-only verification state for non-Capture Exhibits, Derived File verification limits,
the absent MHTML Parts tab, and for #1148 the new bytes entering the chain and the export
refusal.
