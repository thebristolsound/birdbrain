# Case Archive Import/Export (`.birdbrain`) — Design

**Date:** 2026-07-03
**Status:** Approved
**Related:** existing evidence export (`src/main/services/export.ts`, #124), manifest chain (#118–#125), trusted time (#120)

## Problem

Birdbrain has a one-way, court-oriented evidence export (report + verification materials). There is no way to move a case between instances — for sharing with a collaborator or for backup/restore. The evidence zip omits notes, tags, selectors, annotations, favorites, analyses, and extracted data, and nothing can read it back in.

## Decisions (made with user)

1. **Full fidelity** — the archive carries everything case-scoped; an imported case is functionally indistinguishable from the original.
2. **New dedicated `.birdbrain` archive format** — the evidence export stays untouched and court-focused.
3. **Import always creates a new case** — no merge logic; re-import yields a duplicate case.
4. **Verify + preserve + append provenance** — verify hashes/chain on import, keep the source manifest verbatim, append a signed `import` entry continuing the chain.

## Archive format

A zip written with the existing `createStoredZip` (entries stored, uncompressed — consistent with the evidence zip; keeps hashing trivial):

```
<case-name>.birdbrain
├── package.json      # header + integrity index (see below)
├── data.json         # all case-scoped DB rows, grouped by table
├── manifest.jsonl    # source case's hash-chained manifest, byte-for-byte verbatim
└── files/            # <captureId>.mhtml / .html / .png / .txt
```

### `package.json`

- `schemaVersion: 1` (archive format version — independent of DB `user_version`)
- `exportedAt`, `toolVersion`
- Source identity: `installationId`, operator name/role/organization
- `signingPublicKeyPem` — the source installation's public key, inline
- Counts (captures, notes, tags, …) for cheap preflight display
- `artifacts[]` — `{ path, sha256, sizeBytes }` for every other entry in the zip (same pattern as `evidence.json`)
- `packageHash = sha256(canonicalStringify(sortedArtifacts))` (sorted by path; same recipe as the evidence export)

### `data.json`

Rows grouped by table: `case`, `captures`, `tags` (only tags referenced by the case's captures — tags are global in the DB), `capture_tags`, `selectors`, `selector_matches`, `notes`, `annotations`, `annotation_pins`, `capture_favorites`, `capture_analyses`, `extracted_data`, `capture_archive_refs`.

FTS tables (`captures_fts`, `notes_fts`, `extracted_data_fts`) are **not** exported; they are rebuilt via the normal insert paths on import. Thumbnails (`*_thumb.jpg`) are not exported; they regenerate on demand.

## Export flow

New service `src/main/services/caseArchive.ts`, `exportCaseArchive(caseId, outputPath, onProgress)`:

1. Read all case-scoped rows plus referenced tags.
2. Add capture files (`mhtml`/`html`/`png`/`txt`) to the zip, hashing each into `artifacts[]`.
3. Copy `manifest.jsonl` verbatim.
4. Write the zip, then append a signed `archive-export` manifest entry to the live case manifest recording `packageHash`. Same ordering discipline as the evidence export: the bundled manifest copy lags the live manifest by exactly this one entry; the append happens after the zip is written, and a failed append best-effort deletes the orphaned zip and rethrows.

No verification pass runs at export time — the archive carries the materials for the importer to verify.

**Precondition:** verify-core must tolerate (or be extended to handle) the new `archive-export` and `import` entry types. If `verifyManifestChainText` hard-fails on unknown types, extend it as part of this work.

## Import flow — two IPC phases

### Phase 1 — inspect (`cases:inspectArchive`)

Read-only. Opens the archive and returns a preflight report:

- Case name/description, per-table counts, source operator/installation, exportedAt, toolVersion.
- Full verification result:
  - every `artifacts[]` sha256 recomputed and checked,
  - manifest chain verified against the **bundled** source public key (not the local one),
  - every capture's content hash checked against its manifest `capture` entry.
- Archive `schemaVersion` newer than supported → refuse with "update Birdbrain".

The UI shows this report before the user commits.

### Phase 2 — import (`cases:importArchive`)

1. **Tamper policy:** clean verification proceeds. A failing package is blocked unless the user explicitly confirms an override. Either way, the import manifest entry records the verification result — a tampered import is permanently labeled as such.
2. **IDs:** new case ID always. Child row IDs (captures, notes, selectors, annotations, pins, analyses, extracted data, archive refs) are kept when free; colliding IDs (the re-import case) get fresh UUIDs, with FKs remapped consistently. The old→new map is written to `<caseDir>/import-id-map.json`; its sha256 is committed in the `import` manifest entry (keeps the entry small). Row-to-manifest linkage survives remapping because verification matches rows to the manifest via `manifestIndex`/`entryHash`/`hash` stored on the row, not via row ID — but capture files on disk **must** be named by the final row ID (`<caseId>/<captureId>.<ext>`), so staged files are named accordingly.
3. **Atomicity:** files extract to a staging directory first, where the source `manifest.jsonl` is written verbatim and the signed `import` entry is appended to it **while still staged** (via the existing `withManifestEntry` write-ahead/rollback seam) — so the manifest is durably complete before anything is registered. The staging dir is then moved into `<storageRoot>/<newCaseId>/` by an atomic rename (the commit point), and only then do all rows insert in one SQLite transaction (FTS populated via existing insert paths). Failure rolls back cleanly at every stage: before the rename, the staging dir (with its rolled-back manifest) is removed; after the rename, the just-created `<storageRoot>/<newCaseId>/` is removed and the transaction rolls back. No path leaves a partially registered case on disk.
4. **Tags:** matched by name (case-insensitive) and reused; otherwise created.
5. **Manifest:** the `import` entry appended to the staged manifest (step 3, before the rename) **continues the chain** (`prevHash` = source head's `entryHash`). Entry fields: `type: 'import'`, `sourceCaseId`, `caseId` (new), `sourceInstallationId`, `sourcePublicKeyPem`, `packageHash`, `verificationResult`, `idMapSha256`, importing operator id/name, `toolVersion`, `timestamp`.

## Verify-core extension — multi-signer chains

`verifyManifestChainText` currently verifies all signatures against a single public key. Extension: segment-aware key resolution.

- An `import` entry's embedded `sourcePublicKeyPem` verifies all entries **before** it, back to the previous `import` boundary (or genesis).
- Entries after the last `import` entry verify against the locally supplied key.
- Composes for multi-hop (A→B→C): each hop's import entry carries the pem for its preceding segment.
- Hash-chain linkage (index/prevHash/entryHash recomputation) is unchanged.

This is the only change to the shared, court-sensitive verify code and receives the heaviest test coverage.

## Zip reading

No new dependency. A minimal stored-zip reader, `src/main/services/zipRead.ts` (~100 lines): parses the end-of-central-directory record and central directory, extracts stored (method 0) entries only. Sufficient because `.birdbrain` archives are only ever produced by Birdbrain's own stored-zip writer. Malformed/compressed entries → clean error ("not a valid Birdbrain archive").

## IPC & UI

**Channels** (in `src/shared/ipc.ts`, `cases:` domain):

- `cases:exportArchive` — `{ caseId, outputPath }` → progress events + completion
- `cases:inspectArchive` — `{ archivePath }` → preflight report
- `cases:importArchive` — `{ archivePath, overrideTamper?: boolean }` → `{ newCaseId }` + progress events

**Export UI:** "Export case archive…" action on the Case Overview → save dialog (default `<case-name>.birdbrain`) → progress → done toast. Presented distinctly from the existing "Export report" evidence flow.

**Import UI:** "Import case…" button on the Dashboard → open dialog (filter `.birdbrain`) → verification report screen (green/amber/red with counts; red requires explicit override confirmation) → progress → navigate to the new case.

## Error handling & edge cases

- Archive `schemaVersion` newer than supported → refuse ("update Birdbrain").
- Older archives: missing newer fields treated as absent (same tolerance DB migrations give legacy rows).
- Capture content missing from the archive: a capture that legitimately never had stored content is simply absent from `artifacts[]` (see legacy `html` captures below) and imports as-is — there is no blob to be missing. A blob that **is** declared in `artifacts[]` but absent from the zip means a truncated or tampered archive: inspect's per-artifact existence/hash check fails, `overallValid` is false, and import is blocked unless the operator explicitly overrides (the override is recorded permanently in the `import` entry). A declared-but-absent blob is never silently imported.
- Legacy `html`-format captures (no MHTML, no manifest entry) round-trip as-is.
- Operator name unset in settings → block export/import with the same message pattern the evidence export uses (the `import`/`archive-export` manifest entries need an operator).
- Import interrupted mid-way (crash) → staging dir is orphaned in a temp location, never a half-registered case; a subsequent import re-stages from scratch.

## Testing

**Unit (vitest, `tests/`):**

- Round-trip: export → import into fresh temp DB/storage → row-count and content equality per table; files byte-identical; FTS queries return imported content.
- Re-import: ID collisions remapped consistently (FKs intact), `import-id-map.json` written, sha256 committed.
- Tag merge by name (case-insensitive), including color-conflict (existing tag wins).
- Tamper detection: flipped byte in an MHTML file, in `data.json`, in `manifest.jsonl` — each caught at inspect; import blocked without override; override records failing verification in the import entry.
- Multi-signer chain verification: single hop and A→B→C multi-hop; wrong key fails; segment boundaries exact.
- Newer `schemaVersion` refused; older archive with missing fields imports.
- `zipRead`: round-trip against `createStoredZip` output; corrupt/truncated/compressed input errors cleanly.

**E2E (Playwright, `e2e/`):**

- Export a seeded case, import the archive, assert the new case renders captures/notes/tags and the capture verify badge shows verified.

## Out of scope

- Merge-into-existing-case import.
- Selective/partial export (checkbox fidelity).
- Compressed zip entries.
- Importing evidence-report zips.
