# Plan: apply received entries to the local database (#1811)

**Status:** done, finished by [#1879](https://github.com/thebristolsound/birdbrain/pull/1879)

The pull request that closes #1811 builds this plan. The maintainer approved the plan on 2026-10-15 and took the
recommended answer to every question in section 9. Issue #1811 is SC-2b in
`docs/plans/2026-10-10-three-programme-agent-briefs.md:233`. This plan was written against
PR #1873 (issue #1512) at 33b3235b, and every `file:line` citation refers to that commit.
`origin/main` was at 3bd1287f when this was written.

## 1. Summary

#1873 stores another member's chain and files but writes no `captures`, `exhibits` or
`capture_texts` row for that member's Captures, so a joined member lists none of them. This plan
adds one step to the sync session, called `apply`. It runs after the file step and before the
working-layer row pages, and it does three things:

- It removes every received Capture whose author has since signed a `deletion` for it. It reuses
  the file handling of the author's own delete and writes no entry.
- It writes the rows for every received Capture and Exhibit whose anchored files are on disk and
  hash to what the author's entry anchors. All of them go into one transaction per session.
- It hands each new Capture to the post-ingest work the Capture Lifecycle runs: Selector matching,
  data extraction, and the field build.

After the apply step commits, the session refreshes the Trusted Time mirror for the Case through
#1713's resolution. Separately, the timestamp worker and the startup backfill learn to skip any
Exhibit whose row names another author. The delete action refuses another member's Capture, as
decision 10 of the collaborative cases design requires. Finally, the thumbnail of a received
Capture is shown without writing a file at the path its author's chain may anchor later.

No schema migration is needed.

## 2. Where the apply step runs, and what changes for held-back rows

### Today

`pullFromPeer` runs five steps in this order:

1. Entries (`src/main/services/sharing/session.ts:472-611`).
2. The `merge` entry (`:613-628`).
3. Files (`:630-664`).
4. Working-layer row pages (`:666-701`).
5. One apply of every received row (`:702-714`).

That apply is `applyRows` (`src/main/services/db/workingRowRepo.ts:421-470`), a single
`withTransaction` with `defer_foreign_keys = ON` (`:423`). If a reference is still unsatisfied at
commit, the transaction throws and nothing of the batch lands. The session then records a `peer`
error that begins "rows received this session could not be applied" (`session.ts:711-713`).

Because nothing writes a `captures` row for another member's Capture, any received annotation,
pin, tag application or note on a teammate's Capture fails that commit. Every member's rows for
that session roll back with it. The comment at `session.ts:702-707` says this holds "until #1811
writes Capture rows."

Three tests pin this behaviour:

- `rolls back every row of a session whose reference is missing, and lands them once it exists`
  (`tests/main/services/sharing/syncPeers.test.ts:709-748`) proves it.
- `standInCaptureRow` (`:599-610`) inserts a stand-in row by hand to get past it. It is called at
  `:624` and `:738`.

### After #1811

The new `apply` step sits between the file loop (`session.ts:641-664`) and `onPhase('rows')`
(`:672`). It commits its own transaction before the first `rows-request` goes out.

The working-layer rule does not change. `workingRowRepo.ts` is not edited. Rows still apply in one
deferred-foreign-key transaction per session, and a failure still rolls back every author's rows
for that session, with no per-author retry.

The received Capture and Exhibit rows only have to exist before the working-layer transaction
commits. That transaction defers its foreign keys, so the rows would also satisfy them from inside
the same transaction, in either order. This plan recommends a separate transaction that commits
first, for three reasons:

- **The Case check gets stronger.** `caseRefusal` (`src/main/services/sharing/workingRows.ts:260-264`)
  can then read a received Capture's Case while it verifies each row page. Today it passes a row
  whose Capture is not held (`held === undefined`) and leaves the check to the foreign key.
- **A working-layer fault no longer hides the Captures.** An id collision in `applyRows`
  (`workingRowRepo.ts:435-444`), or a foreign-key failure on a deleted Capture, must not take
  teammates' Captures out of the list.
- **Deletions are not database-only.** A received deletion moves files on disk, so it cannot sit
  inside a database transaction anyway.

The evidence transaction follows the same per-session rule as the row transaction. Some entries
can never be written and would fail the same way every session: an id held by another row, a
missing Exhibit Number, or a taken number. The apply step refuses those one entry at a time before
the transaction opens, the way `verifyRemoteRows` (`workingRows.ts:301-340`) refuses rows before
`applyRows` runs. If anything else throws inside the transaction, none of it lands, and the session
records a `local` error and continues to the rows step.

A working-layer row still rolls back the whole session when it references a Capture or Exhibit
that falls into one of these cases:

- **Files not yet on disk.** Not every file its entry anchors has arrived, or one failed the hash
  check. Such a Capture gets no row, per the acceptance criterion.
- **Refused or rolled back.** Its entry was refused one entry at a time, or this session's evidence
  transaction rolled back.
- **Deleted here, still offered elsewhere.** Its author deleted it and this replica has applied
  that deletion, but the peer serving this session has not applied it yet and still offers rows on
  it.
- **Never stored.** Its entry sits in a part of a chain this replica does not store:
  - after a newer-version stop,
  - past a revoked member's merged bound, or
  - before its author's last `import`, which the file step never fetches
    (`src/main/services/sharing/blobAcceptance.ts:146-147`).

### Test changes

Delete `standInCaptureRow` and its call at `syncPeers.test.ts:624`. That test then expects
`rowsApplied` 6 with no stand-in, because the apply step writes Alice's Capture row first.

Rewrite the test at `:709-748` so it still proves the per-session rollback, now with a reference
#1811 legitimately leaves missing:

1. Alice ingests a Capture, annotates it, and writes a note. Carol's note is already on Bob's side.
2. The recorded source drops the Capture's `.mhtml` from `source.files`.
3. The first session leaves the Capture out of Bob's list and applies 0 rows. Its only error
   contains `FOREIGN KEY`, and Carol's note is absent.
4. After the file goes back into `source.files`, the second session writes the Capture row in its
   `apply` step and applies all three rows in the same session.

Rewrite the comment at `session.ts:702-707` to match.

## 3. Tasks

Tasks 1 and 2 have no dependencies. Task 3 needs Task 2, Task 4 needs Tasks 1 to 3, Task 5 needs
Task 4, Tasks 6 and 7 need Task 5, and Task 8 comes last.

The acceptance tests live in a new file, `tests/main/services/sharing/receivedEvidence.test.ts`.
It uses the two-peer setup from `tests/helpers/syncPeers.ts` with invented content and the
in-process `MemoryHub` transport (`MemoryTransport`). `appendOwnChainLine`
(`tests/helpers/syncPeers.ts:161-173`) is the real-peer counterpart of the `Chain` helper
(`tests/main/services/sharedCaseExport.test.ts:89-107`), and the tests use it for entries no honest
writer produces.

### Task 1. Read a Capture's title from its MHTML

Change `src/main/services/mhtmlDecoder.ts` by adding `readMhtmlTitle(buffer: Buffer): string | null`.

- It reads the top-level headers the way `listHtmlPartsInMhtml` does (`:53-60`), with the existing
  unfolding (`:148-157`), and takes `Subject`.
- It decodes RFC 2047 encoded words, both `Q` and `B` forms, and joins adjacent words without the
  whitespace between them.
- If the `Subject` is absent or empty, it falls back to the first `<title>` of the first text/html
  part. It collapses whitespace and decodes the five XML entities and numeric references.
- It returns null when neither holds a title.

The decoder has no title reader today. No other `Subject` or `<title>` parser exists under
`src/main` or `src/shared`.

Tests go in `tests/main/services/mhtmlDecoder.test.ts`. Use invented titles and cover these cases:

- a plain ASCII `Subject`
- a UTF-8 `Q` word folded across two lines
- a `B` word
- no `Subject`, with a `<title>` holding `&amp;`
- neither, which returns null

### Task 2. Let the repos write another member's rows

**`src/main/services/db/exhibitRepo.ts`**

- `InsertExhibitParams` (`:43-58`) and `CaptureExhibitParams` (`:115-127`) gain an optional
  `author: { installationId: string; memberCode: string }`.
- `insertExhibit` (`:78-113`) writes `member_code` and `author_installation_id` from it, and checks
  the Member Code against `MEMBER_CODE_PATTERN` the way `importExhibitRows` does (`:265-273`).
- `insertExhibit` throws when `author` is set without `exhibitNumber`. Without that check, the
  fallback at `:91` would number from this installation's own sequence
  (`highestLocalExhibitNumber`, `:68-76`) and give a teammate's Exhibit a local number.
- `insertExhibitForCapture` (`:138-154`) passes `author` through.

**`src/main/services/db/captureRepo.ts`**

- `InsertCaptureParams` (`:90-124`) gains `author` and `committedAt`.
- `insertCapture` passes both to `insertExhibitForCapture` at `:240-252`. `committedAt` still
  defaults to now.
- `listPendingTimestampCaptures` (`:302-313`) joins `exhibits` and keeps only rows whose Exhibit
  names no author.

Tests go in `tests/main/services/exhibitModel.test.ts`:

- An author without a number throws.
- An author with an invalid code throws.
- A Capture written with an author cites `<code>-<n>` through `getCapture`.
- The pending list skips a row whose Exhibit names an author even when its mirror reads `pending`.

### Task 3. Two lifecycle operations for received Captures, and the decision-10 guard

Files: `src/main/services/captureLifecycle.ts`, `src/shared/ipc.ts`,
`src/renderer/routes/cases/$caseId/captures.tsx`.

**`processReceived(capture: { id; caseId; url }, textContent: string | undefined): void`**

- It calls `runPostCaptureWork` (`:769-792`), which runs Selector matching, data extraction
  (`:728-748`) and the field build (`:753-767`). CI-4's field build service has merged as PR #1855.
- It does not call `enqueueTimestamp`, the ingest hand-off at `:988`.
- It emits no new-capture event.

**`removeReceived(captureId: string): Promise<boolean>`**

- It runs under `withCaseSlot` (`:800-815`) after `recoverCase` (`:935-956`), as `delete` does
  (`:1103-1116`).
- It runs the body of `deleteOne`'s legacy branch (`:870-895`): move the files aside, delete the
  row (putting the files back if that fails), then purge them. The legacy branch and
  `removeReceived` share that body as one inner function. The MHTML branch (`:831-868`) is
  unchanged.
- It returns false, and touches nothing, for a row whose Exhibit names no author. That way it can
  never remove this installation's own Capture.

**Decision-10 guard**

Decision 10 says "Only the author writes `deletion` for their Exhibit"
(`docs/specs/2026-09-19-collaborative-cases-design.md:54`).

- `deleteOne` (`:829`) returns `{ status: 'rejected', reason: 'not_author' }` for a Capture whose
  Exhibit names another author, before `withDeletionEntry` runs. `delete` then returns false.
- `BatchDeleteOutcome` (`src/shared/ipc.ts:678`) gains `'not_author'`.
- `BatchDeleteSummary` (`captures.tsx:53-65`) counts it, so the summary does not claim "All
  selected captures were removed".

Two-peer tests:

- After a sync, Bob's `deleteMany(CASE_ID, [aliceCaptureId])` returns `not_author`. Bob's own chain
  gains no `deletion`, and the row and files stay.
- `removeReceived` on Bob's own Capture returns false and leaves it in place.

### Task 4. Plan and apply received evidence

Create `src/main/services/sharing/receivedEvidence.ts`. It exports
`applyReceivedEvidence({ caseId, caseDir, self, roster, store, receivedCaptures })` and returns the
inserted ids, the removed ids and a list of `SyncError`. Every SQL statement goes through the
repos, because importing `getDb` outside `src/main/services/db/` is lint-enforced
(`docs/agents/architecture.md:114`).

1. Read every stored member chain with `readChainFileSnapshots`. Skip lineage chains and this
   installation's own chain. Parse it the way `storedEntries` does (`session.ts:243-248`). Keep only
   entries from the chain's last `import` on, the same rule `anchoredFiles` uses
   (`blobAcceptance.ts:146-147`). The author is the chain file's installation id, and the Member
   Code comes from the roster (`case_members`).
2. **Removals, first.** A `deletion` entry is applied when a Capture row with that id exists in this
   Case and its Exhibit names the chain's installation as author. Applying it calls
   `receivedCaptures.removeReceived`. Any other row the entry names is left alone.
3. **Captures.** Take each `capture` entry that no `deletion` in the same chain names.
   - Skip it when a row of this author already exists.
   - Refuse it with `rejected-entry` when the id is held by any other row: another author's, this
     installation's, or one in another Case.
   - Refuse it when no Exhibit Number is found. Look first at `entry.exhibitNumber`, then at the
     author's `renumber` assignment for that id.
   - Refuse it when another id already holds the same Case, author and number, which the unique
     index `idx_exhibits_author_number` enforces (`src/main/services/db/migrations.ts:975-976`).
   - Wait without an error while any anchored file is absent. The anchored files are the `.mhtml`,
     the `.png` when `screenshotHash` is set, and the `.txt` when `textHash` is set, at
     `store.artifactPaths` (`blobAcceptance.ts:130-134`, `:155-159`).
   - Read each present file once, asynchronously, and hash it. On a mismatch, report
     `hash-mismatch` and write no row.
   - Decode the title with Task 1 and the Extracted Text from the `.txt` as UTF-8.
4. **Other Exhibits.** Treat `exhibit` entries the same way. Resolve `entry.path` through
   `safeCasePath` (`blobAcceptance.ts:73-93`). Take the Member Code from `entry.memberCode`, else
   from the roster.
5. **Derived Files.** Plan a `derived_files` row for a `derivation` entry when all of these hold:
   - its parent is a held or planned received Exhibit of the same author, whose `content_hash`
     equals `parentContentHash`;
   - its `outputPath` passes `safeCasePath`;
   - its file hashes to `outputHash`;
   - no row exists yet for that parent, derivation, and hash.

   Store the path in `/` form. The binding rule compares normalized paths
   (`src/shared/verify/exhibitBinding.ts:76-86`).
6. Write every insert in one `withTransaction`:
   - `insertCapture` with `author` writes `captures`, `capture_texts` and `exhibits` together
     (`captureRepo.ts:223-256`).
   - `insertExhibit` with `author` writes the other Exhibits.
   - `insertDerivedFile` writes the Derived Files.

   A throw rolls back every insert.
7. After the commit, call `receivedCaptures.processReceived` for each inserted Capture.

Two-peer tests, mapped to the acceptance criteria:

- **List and citations.** Alice ingests two Captures from invented MHTML. After Bob syncs,
  `listCaptures(CASE_ID)` holds both, with `exhibitCitation` `AL-1` and `AL-2`. `AL` is Alice's
  Member Code in the helper, and the roster holds three members, so the app prefixes citations
  (`src/main/services/db/caseMemberRepo.ts:117-154`).
- **Title.** The MHTML carries `Subject: Harbour Street ledger, March` and the same `<title>`. On
  Bob, `captures.title`, `capture_texts.title` and `exhibits.name` all equal it.
- **Search.** `searchCaptures('brackwater', CASE_ID)` finds the Capture. The word appears only in
  its `.txt`.
- **Extracted data.** The page holds `analyst@example.org`. After post-ingest work drains, Bob holds
  the matching `extracted_data` row.
- **Binding.** `verifyCapture(aliceCaptureId)` on Bob reports `verified`. This proves
  `manifest_index`, `hash` and the sidecar hashes bind to Alice's chain through `authorChainOf`
  (`captureLifecycle.ts:443-449`).
- **No row without files.**
  - With the `.mhtml` dropped from the recorded source, Bob has no row and no error.
  - With a tampered `.png`, the error is `hash-mismatch` and there is no row.
  - With the genuine files, a later session writes the row.
- **Refusals.**
  - An entry from `appendOwnChainLine` whose `captureId` equals Bob's own Capture is refused, and
    Bob's row is untouched.
  - A second entry that reuses Alice's Exhibit Number is refused while the first one lands.
  - A received `deletion` that names Bob's own Capture removes nothing.

### Task 5. Run the apply step in the session

Files: `src/main/services/sharing/session.ts`, `src/main/services/trustedTime.ts`,
`tests/helpers/syncPeers.ts`, `tests/main/services/sharing/syncPeers.test.ts`,
`tests/main/services/sharing/session.test.ts`.

**`session.ts`**

- `SyncSessionOptions` (`:137-139`) gains a required
  `receivedCaptures: Pick<CaptureLifecycle, 'processReceived' | 'removeReceived'>`. It is required
  so a future caller cannot skip deletions by leaving it out. No production caller of
  `pullFromPeer` exists yet; it has no caller outside `session.ts` and the tests.
- `SyncPhase` (`:115`) gains `'apply'`.
- `SyncSessionResult` (`:124-135`) gains `capturesApplied`, `exhibitsApplied` and `removed`.
- Call `applyReceivedEvidence` after `:664`, inside the existing `try`. On a throw, record `local`
  "received evidence could not be applied: <message>" and continue, as `:708-714` does for rows.

**`trustedTime.ts`**

- Extract the per-Case body of `reconcileAllMirrors` (`:200-208`) into `reconcileCaseMirrors(caseId)`.
- The session calls it after the apply step when any chain advanced or any row was inserted. A new
  author stamp can only arrive with new entries.
- Without this, a stamp that arrives in a later session than its Capture stays invisible until the
  next app start.

**Test helper**

- `pull` (`tests/helpers/syncPeers.ts:419-440`) builds a lifecycle for the active peer. The pattern
  is `createCaptureLifecycle({ selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} }) })`,
  as at `sharedCaseExport.test.ts:119-121`.
- After the session, `pull` waits one `setImmediate` turn. Post-ingest work then lands in this
  peer's database before a later `activate` (`:74-84`) switches the singletons to another peer's.
- `addCapture` (`:264-292`) accepts invented MHTML bytes, text, and a screenshot.

**Existing tests**

- Make the changes from section 2.
- `session.test.ts:146` and `:302` pass a stub.
- Re-run every `syncPeers.test.ts` case that asserts `errors: []`. A fixture that reuses an Exhibit
  Number for one author would now record a refusal. A reading of the tests found none, but they
  were not run while writing this plan.

Two-peer Trusted Time test:

- Alice's worker uses a `requestToken` that returns `buildSyntheticToken`
  (`tests/helpers/timestampFixtures.ts:29-58`) and stamps her Capture. After the sync, Bob's
  `trustedTimeStatus` reads `rfc3161`.
- A second case syncs first and stamps afterwards. Bob reads `none` after session 1 and `rfc3161`
  after session 2.

### Task 6. Keep this installation's writers off another member's content

**`src/main/services/timestampWorker.ts`**

- In `stampCapture` (`:66-114`), after the reconcile at `:79`, return false without reaching
  `requestToken` (`:80`) when `getExhibit(captureId)?.authorInstallationId` is a string.
- In `stampExhibit` (`:121-125`), return false when the Exhibit names an author.
- In `listPendingExhibits` (`:175-177`), add `exhibit.authorInstallationId === null` to the filter.
  - Without this, `processPending` (`:201-204`) picks up a received document Exhibit and stamps it
    into this installation's chain.
  - Received Captures already resolve `none` or `rfc3161` rather than `pending` under #1713. The
    local chain holds no `capture` entry for their hash, and `trustedTimeEntries` takes only
    `timestamp` entries from other chains (`trustedTime.ts:76-100`,
    `src/shared/verify/trustedTime.ts:106-116`).
  - Task 2's query change keeps them out of the capture queue even when they share a hash with a
    local Capture.

**`src/main/services/exhibitBackfill.ts`**

In the `backfillCase` loop (`:346-361`), skip every Exhibit whose `authorInstallationId` is not
null.

The skip is needed because the loop reads `captureEntriesByIndex.get(exhibit.manifestSeq)` from
this installation's own chain (`:342`, `:348-351`). A received Exhibit's `manifestSeq` indexes its
author's chain, as the comment at `:89-91` already says. The lookup therefore reads an unrelated
local entry, with two possible outcomes:

- If that entry's `screenshotHash` matches the received screenshot, `backfillThumbnail` signs a
  `derivation` naming the teammate's Capture (`:274-300`).
- Otherwise it records the thumbnail unanchored (`:244-255`).

The renumber step already skips other authors (`:95`).

Two-peer tests for the writer criterion:

**Setup**

1. Alice commits an unstamped document with `addDocument` and an unstamped Capture.
2. Bob ingests one Capture of his own as a positive control.
3. Bob syncs.

**Straight after the sync**

- Bob's worker records every `requestToken` call. Run `processPending()`, then call `stampExhibit`
  and `stampCapture` directly on the received ids. The recorder holds only Bob's own hash.
- Bob's own chain holds no entry naming a received id or hash:
  - no `captureId`, `exhibitId` or `parentExhibitId` equal to one,
  - no `captureContentHash` equal to one,
  - no `renumber` assignment naming one.

  Every entry that names one is a `merge`.

**After a restart**

1. Run `closeDatabase()`, then `activate(B)`.
2. Run `runExhibitBackfill({ toolVersion: '0.0.0' })` and `worker.start()`, then drain and stop.
3. Check the same assertions.

**Backfill regression**

Pad Bob's chain so his own `capture` entry sits at the index of Alice's received Capture, with the
same invented PNG. Before the guard, `backfillCase` signs a `derivation` naming Alice's Capture.
After the guard it signs nothing.

### Task 7. Show a received Capture's thumbnail without taking its anchored path

Files: `src/main/services/thumbnails.ts`, `src/main/ipcHandlers.ts`.

- `getThumbnail` (`:92-123`) gains `{ persist = true }`. With `persist: false` it renders and
  returns the bytes, and skips the `writeFile` at `:117`.
- The `captures:getThumbnail` handler (`ipcHandlers.ts:897-907`) passes `persist: false` when
  `getExhibit(captureId)?.authorInstallationId` is a string.

Section 6 explains why.

Tests:

- **Unit.** In `tests/main/services/thumbnails.test.ts`, `persist: false` leaves no file on disk.
- **Two-peer, case (a).** Alice ingests a Capture with a real invented PNG, made with
  `sharp({ create })`, and has no thumbnail `derivation`. Bob's handler returns a thumbnail. No file
  exists at `<caseId>/<id>_thumb.jpg`, no `derived_files` row exists, and Bob's chain holds no
  `derivation`.
- **Two-peer, case (b).** Alice also runs `backfillCase`, which simulates her restart. After Bob
  syncs, the thumbnail file is on disk with Alice's hash. The `derived_files` row has
  `manifest_seq` equal to Alice's `derivation` index, and `verifyCaseDerivedFiles` reports
  `verified`.

### Task 8. Record the new module's tier and the PR statements

- Add `src/main/services/sharing/receivedEvidence.ts` to the "Shared Case sync" table in
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` at blocking tier, as #1873 did for
  its four modules. The reason: it decides which received Captures and Exhibits become rows, and it
  removes a teammate's Capture and its files on that teammate's deletion.
- The PR body carries the section 4 column table, the section 5 migration statement, and the
  section 6 thumbnail statement.

## 4. Columns the receiver fills

"Entry" means the author's signed `capture` entry (`src/shared/schemas.ts:455-516`) or `exhibit`
entry (`:741-775`).

### `captures`

Columns are in `CAPTURE_COLUMNS` order (`captureRepo.ts:129-164`), from
`migrations.ts:23-35, 222-234, 264-266, 364, 379-380, 393, 462-463, 475, 712`.

| Column | Value | Source |
|---|---|---|
| `id` | `entry.captureId` | signed entry |
| `case_id` | the synced Case, which `entry.caseId` must equal (`foreignCaseEntry`) | signed entry |
| `url` | `entry.url` | signed entry |
| `title` | the MHTML `Subject`, else its first `<title>`, else `entry.url` (the admit fallback, `captureLifecycle.ts:1063`) | received file |
| `html_path` | NULL | column default |
| `screenshot_path` | `<caseId>/<id>.png` when `entry.screenshotHash` is set | received file |
| `hash` | `entry.contentHash`, re-checked against the received MHTML | signed entry |
| `timestamp` | `entry.timestamp` | signed entry |
| `headers` | JSON of `entry.headers`, NULL when absent, as `duplicate` writes it (`captureLifecycle.ts:1324`) | signed entry |
| `created_at` | the receiver's clock at apply. The column is NOT NULL with no default, so neither entry nor file supplies it. | receiver at apply |
| `format` | `'mhtml'`, because the content hash anchors the `.mhtml` artifact (`blobAcceptance.ts:130-134`). The column default would be `'html'`. | received file |
| `mhtml_path` | `<caseId>/<id>.mhtml` | received file |
| `size_bytes` | `entry.sizeBytes` | signed entry |
| `manifest_index` | `entry.index`, in the author's chain | signed entry |
| `prev_hash`, `entry_hash` | `entry.prevHash`, `entry.entryHash` | signed entry |
| `tool_version` | `entry.toolVersion` | signed entry |
| `extension_version`, `browser_version` | NULL, because the entry carries neither | column default |
| `user_agent` | `entry.userAgent` when present (schema 5), else NULL | signed entry, else column default |
| `http_status` | `entry.httpStatus`, else NULL | signed entry, else column default |
| `operator_id`, `operator_name` | `entry.operatorId`, `entry.operatorName` | signed entry |
| `last_verified_at`, `_hash`, `_status` | NULL, because a result is what verification here found (#1523's rule) | column default |
| `trusted_time_status` | NULL at insert, then `rfc3161` or `none` from Task 5's reconcile | the author's signed `timestamp` entry, through #1713 |
| `screenshot_hash`, `text_hash` | `entry.screenshotHash`, `entry.textHash` | signed entry |
| `tls_cert_chain` | JSON of `entry.tls` | signed entry |
| `method` | `entry.method`, else `'extension'` | signed entry, else column default |
| `supersedes_capture_id`, `consent_suppression`, `duplicate_of_capture_id` | the entry's field, else NULL | signed entry, else column default |

`finalUrl`, `duplicatedAt`, `egressKind`, `egressLabel` and `tlsSkipped` have no column, exactly as
for local rows. `exhibitNumber` goes to `exhibits`.

### `exhibits`

This table was rebuilt by v36 (`migrations.ts:949-976`).

| Column | Received Capture | Received non-Capture Exhibit | Source |
|---|---|---|---|
| `id` | `entry.captureId` | `entry.exhibitId` | signed entry |
| `case_id` | the synced Case | the synced Case | signed entry |
| `kind` | `'capture'` | `entry.kind` | signed entry |
| `origin` | `entry.method`, else `'extension'` (`exhibitRepo.ts:138-146`) | `entry.origin` | signed entry |
| `exhibit_number` | `entry.exhibitNumber`, else the author's `renumber` assignment | `entry.exhibitNumber` | signed entry |
| `name` | the title above, else `entry.url` | `entry.name` | received file for a Capture, signed entry otherwise |
| `content_hash` | `entry.contentHash` | `entry.contentHash` | signed entry |
| `path` | `<caseId>/<id>.mhtml` | `entry.path` | received file |
| `size_bytes` | `entry.sizeBytes` | `entry.sizeBytes` | signed entry |
| `committed_at` | `entry.timestamp` | `entry.timestamp` | signed entry, as #1511's fixtures do (`sharedCaseExport.test.ts:196-215`) |
| `manifest_seq` | `entry.index` in the author's chain | `entry.index` in the author's chain | signed entry |
| `member_code` | the author's code from the roster | `entry.memberCode`, else the roster | roster, which caches the Owner's `member-add` |
| `author_installation_id` | the chain file's installation id | the chain file's installation id | author's chain |

For a received Capture, `committed_at` is the page timestamp. A local Capture records its ingest
time there instead, which no entry carries.

### `capture_texts`

This table comes from v25 (`migrations.ts:489-495`).

| Column | Value | Source |
|---|---|---|
| `id` | assigned by SQLite | column default |
| `capture_id` | `entry.captureId` | signed entry |
| `title` | same as `captures.title` | received file |
| `url` | `entry.url` | signed entry |
| `content` | the received `.txt` as UTF-8 when `entry.textHash` is set, else `''` | received file, else column default |

### `derived_files`

This table is needed for "shows their Derived Files" in the brief. The values come from the
author's `derivation` entry (`schemas.ts:802-833`):

| Column | Value |
|---|---|
| `exhibit_id` | `parentExhibitId` |
| `derivation` | `derivation` |
| `tool_version` | `derivationToolVersion` |
| `content_hash` | `outputHash` |
| `path` | `outputPath`, in `/` form |
| `created_at` | the entry's `timestamp` |
| `manifest_seq` | the entry's index in the author's chain, following `sharedCaseExport.test.ts:512-517` |

## 5. Schema migration

None is needed, so #1811 does not take the database migration lane.

- Authorship of a Capture lives on its Exhibit row. `exhibits.member_code` and
  `exhibits.author_installation_id` exist since v36, and the list and search reads already join
  them (`captureRepo.ts:28-31`).
- Every column in section 4 already exists.
- Nothing changes the Case Archive format or a Manifest Entry shape, so neither of those lanes is
  taken either.

If CE-3 merges first and mirrors the Egress fields onto `captures`, Task 4 must fill those columns
from the received entry. That still adds no column of its own.

## 6. The thumbnail of a received Capture

The answer depends on whether the author's chain anchors the thumbnail.

### Case (a): the author's chain holds a thumbnail `derivation`

The thumbnail is anchored by the author's chain. Ingest signs no thumbnail: `ingestMhtmlCapture`
writes no `derivation` (`captureLifecycle.ts:306-376`), and `getThumbnail` writes an unanchored
file (`thumbnails.ts:92-123`). The author's chain gains the `derivation` only when the author's
startup backfill signs one (`exhibitBackfill.ts:274-300`, run from `src/main/index.ts:550`). After
that:

- The file step fetches the output, hash-checked (`blobAcceptance.ts:164-165`).
- Task 4 records a `derived_files` row whose `manifest_seq` is the author's entry index.
- `verifyDerivedFiles` binds it against the author's chain (`src/main/services/exhibits.ts:318-324`).

### Case (b): it does not, or not yet

The list shows a thumbnail rendered in memory from the received, hash-checked screenshot (Task 7).
It is recorded nowhere and anchored by nothing, and the receiver's backfill signs nothing for it
(Task 6).

This differs from the acceptance criterion's "recorded unanchored" wording on purpose. Under
today's code, the receiver's `getThumbnail` would write its own render at
`<caseId>/<id>_thumb.jpg`, the same path the author's later `derivation` anchors. Two things
follow:

- **The anchored file never arrives.** The file step skips any path already on disk
  (`blobAcceptance.ts:175-182`).
- **A false accusation follows.** If an unanchored `derived_files` row were recorded for the
  receiver's render, the author's entry would bind it by path with a different hash. Verification
  would then report `tampered` (`exhibitBinding.ts:103-105`) on the receiver's Data screen, a false
  accusation of tampering against the author.

## 7. Hot-file merge order and rebase cost

`git log origin/main --oneline -i --grep=<issue>` returns nothing for any of these issue numbers.
Squash commits on `main` name the PR, not the issue. Issues map to PRs through each PR body's
"Closes #N" line, read through the REST API. `origin/main` was at 3bd1287f.

| Hot file | Must merge after | State | Rebase cost for #1811 |
|---|---|---|---|
| `captureLifecycle.ts` | #1815 | open, no PR | It changes how `deleteOne` signs a renamed import's deletion (`:836-846`). Task 3 edits the same function's start and its legacy branch (`:870-895`). Adjacent hunks, small manual merge. |
| | CE-3 (#1695) | open, no PR | It changes ingest (`:59-86`, `:306-328`), which Task 3 does not touch. If it mirrors Egress fields onto `captures`, Task 4's mapping follows. |
| | CI-4 field build | merged as PR #1855, 2026-10-14 | None. `runFieldBuild` is already in `runPostCaptureWork`. |
| `exhibitBackfill.ts` | #1814 | PR #1872 open | It reworks how `backfillCase` resolves each Capture's signed id in the thumbnail loop. Task 6 adds one skip in that loop. Small conflict. |
| | #1813 | open, no PR, waiting on the maintainer's option pick | Unknown until an option is chosen. Likely small. |
| `captureRepo.ts` | CI-1 (#1590) | closed by PR #1807, 2026-10-12 | Free. |
| `trustedTime.ts`, `timestampWorker.ts` | SC-1 (#1713) | closed by PR #1844, 2026-10-13 | Free. SC-4 (#1515) follows #1811. |

#1873 must merge first. The issue also lists #1713 as a blocker, and it has merged.

## 8. Risks

- **Rows can still be held back.** One Capture whose `.mhtml` the serving peer lacks still holds
  back every member's working-layer rows, in every session, until the file arrives. Section 2 lists
  the other triggers. The maintainer's ruling accepts this, but users still see it as a recurring
  sync error.
- **A received deletion cascades through foreign keys.** It removes other authors' signed
  annotations and pins (`migrations.ts:1218`, `:348`) and their tag applications through
  `exhibits` (`:1252`). It sets `notes.capture_id` to NULL (`:192`) without re-signing. A note
  changed that way fails its signature when this replica serves it onward. Every local Capture
  delete has done the same in a Shared Case since #1873, because #1873 leaves
  `captureLifecycle.ts` unchanged.
- **Deletion is transient across peers.** After Bob applies Alice's deletion, a session with Carol,
  who has not applied it yet and still offers rows on that Capture, fails its row commit until Carol
  syncs.
- **Refusals repeat.** The one-entry refusals in Task 4 recur every session, so the sync error
  state stays set until the author's chain changes.
- **Titles can diverge.** The author's own row takes the extension's page title, while the receiver
  takes the MHTML `Subject`. When the two differ, the same Exhibit carries two names on two
  replicas. Ruling 7 accepts re-derivation.
- **The main process does more work.** Each new received Capture's MHTML, up to 200 MB
  (`MAX_MHTML_SIZE`), is read whole for the hash and title, and again by data extraction on the
  main process (#598).
- **Post-ingest work can be lost.** It runs on `setImmediate`, so a crash right after the commit
  loses it. `ensureCaseFields` catches the field build on Case open; only Reprocess catches
  extraction.
- **The apply step is test-only for now.** `pullFromPeer` has no production caller, so the
  scheduler issue must pass the app's Capture Lifecycle.
- **Export is untested here.** This plan's tests do not export a Shared Case holding received
  Capture rows. #1511 tested export with hand-written rows.
- **sharp can crash the tests.** Task 7's tests use sharp, which crashes under Electron on some
  Linux machines. Run them with `BIRDBRAIN_TEST_SYSTEM_SHARP=1` there (`docs/agents/testing.md:18-30`).

## 9. Questions the maintainer answered

The maintainer took the recommended answer to all nine on 2026-10-15: a separate evidence
transaction before the working-layer rows; a row only once every anchored file has arrived and
matched; an in-memory thumbnail with nothing recorded when the author's chain anchors none;
Trusted Time stays `none`; the delete guard ships in this PR; received deletions cascade as local
ones do, with one follow-up issue for both; a received `deletion` of a non-Capture Exhibit is
skipped; Captures before the author's last `import` get no row; and #1811 is built now, merging
after #1815 and CE-3 if they are ready and ahead of them otherwise.

1. **Transaction.** Should received Capture and Exhibit rows commit in their own transaction after
   the file step and before the working-layer rows, as this plan recommends? The alternative is to
   join the one deferred-foreign-key transaction that lands the working-layer rows. Joining means a
   working-layer failure, such as a row on a Capture this replica deleted, would also keep
   teammates' Captures out of the list for that session.
2. **Files required.** Should a received Capture get a row only when its MHTML, screenshot, and text
   have all arrived and hash correctly, as recommended, or as soon as its MHTML has? The first rule
   keeps every row's sidecars verifiable. The second shows the Capture sooner but leaves its
   screenshot and text to be filled in by a later session.
3. **Unanchored thumbnail.** When the author's chain does not anchor a received Capture's thumbnail,
   may the app show a thumbnail rendered in memory and record nothing, as recommended, instead of
   the "recorded unanchored" wording in the acceptance criteria? Recording one would put a file at
   the path the author's later `derivation` anchors, so the anchored file would never arrive, and
   verification would report it `tampered`.
4. **Trusted Time display.** A received Capture whose author has not stamped it yet reads Trusted
   Time `none` under #1713's rule. CONTEXT.md defines `none` as a grandfathered legacy Capture
   (`CONTEXT.md:167-169`). Should it read `pending` instead? That changes the eligibility rule in
   `trustedTime.ts`. This plan keeps `none` and relies on authorship, not the mirror, to keep the
   timestamp worker away.
5. **Delete guard.** Should this PR also make the delete action refuse another member's Capture,
   with a new `not_author` batch outcome and a line in the delete summary (Task 3), or should that
   move to a follow-up? Without it, deleting a teammate's Capture writes a `deletion` naming it into
   the receiver's own chain, against decision 10, and the next sync brings it back.
6. **Cascades on deletion.** Is it acceptable for this PR that a received deletion cascades through
   other authors' signed working-layer rows on that Capture, exactly as a local deletion has done
   since #1873? The alternative is to file one follow-up covering both kinds of deletion.
7. **Deleting a document.** A received `deletion` can name a non-Capture Exhibit such as a document,
   but this build has no local deletion path for those to mirror. The only `withDeletionEntry`
   caller is `captureLifecycle.ts:836`. Should the receiver skip writing a row for such an Exhibit
   and leave an already-held row in place, as recommended, or remove the row and its file?
8. **Imported history.** In a Case that was imported or forked and then shared, Captures recorded
   before the author's last `import` never get a row. #1873's file step does not fetch their files.
   Is that acceptable for this issue?
9. **Merge order.** #1815 and CE-3 (#1695) come before #1811 in `captureLifecycle.ts`, and neither
   has a PR yet. Should #1811 wait for them, or merge ahead and pass the rebase cost to them?

## 10. Verification

From the issue: `pnpm lint`, `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` (the
two-peer tests by path, then the full suite), `pnpm build`, then `pnpm preflight` at head.

```bash
pnpm lint
pnpm typecheck
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/receivedEvidence.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/sharing/syncPeers.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test
pnpm build
pnpm preflight
```

`pnpm test <path>` takes no `--` (`CLAUDE.md:9`).
