# Plan: receipt stamps on `merge` entries (#1515)

**Status:** done, finished by [#1912](https://github.com/thebristolsound/birdbrain/pull/1912)

Plan only. Nothing here is built. Issue #1515 is SC-4 in
`docs/plans/2026-10-10-three-programme-agent-briefs.md:265`, and step 7 of the build order in the
collaborative cases design (`docs/specs/2026-09-19-collaborative-cases-design.md:344`). This plan
was written against `origin/main` at 58997988 (PR #1872 merged), and every `file:line` citation
refers to that commit. It records a reading pinned to that commit, the exception `docs/README.md`
makes for line citations. Two unmerged branches were read for section 8 only: #1811's
`feat/1811-received-entries` at 36ecaf34 (draft PR #1879) and #1864's `feat/1864-member-chains`
at 713099a2 (draft PR #1880).

## 1. Summary

Decision 15 of the collaborative cases design reads: "The receiver submits the `merge` entry's
Entry Hash to its TSA. On by default when a TSA is configured"
(`docs/specs/2026-09-19-collaborative-cases-design.md:59`). This plan calls the result a *receipt
stamp*: a `timestamp` entry with `subject: 'entry'` whose `captureContentHash` field holds a
`merge` entry's Entry Hash. #1518 defined that field and made every Trusted Time reader leave such
an entry out (section 2). Nothing writes one yet.

The plan does five things:

- The Manifest writer accepts `subject: 'entry'` on a `timestamp` entry and stamps it schema 4.
- The timestamp worker gains `stampMerge`, and the sync session hands it the `merge` it writes. A
  session that writes a `merge` submits exactly one receipt stamp, over that entry's Entry Hash. A
  session that writes none submits none. Content stamps keep their code path and their entry shape.
- Verify-core gains the receipt rule beside `stampFor`: a receipt stamp binds a `merge` in its own
  chain when its token's imprint equals that entry's Entry Hash.
- The package checker, and through it the standalone verifier, report each receipt stamp on a row
  of its own. `verify.sh` and `VERIFY.md` check each receipt token with `openssl ts -verify`,
  decoded from its signed line. Packages gain no file for it, and `export.ts` does not change
  (section 5).
- A known-answer test pins a real DigiCert token over the Entry Hash of a fixed `merge` entry.

No manifest schema, database schema, Case Archive, or `evidence.json` version changes (section 6).

## 2. What exists today

**The entry shape is defined.** `ManifestTimestampEntrySchema` carries `subject: 'content' |
'entry'`, omitted for content (`src/shared/schemas.ts:589-611`), and refuses `subject` below
schema 4 (`:613-619`). `MANIFEST_SCHEMA_VERSION` is 5 (`src/shared/constants.ts:81`). The hash
field keeps its `captureContentHash` name for hash stability (`schemas.ts:584-588`), so a receipt
stamp carries the Entry Hash in that field.

**Every reader already keeps a receipt stamp out of Trusted Time.**

- Verify-core's `bindsContent` (`src/shared/verify/trustedTime.ts:32-40`) gates `stampFor`
  (`:57-79`) and `buildTrustedTimeIndexFromEntries` (`:126-158`).
- The package checker reads content stamps only (`src/shared/verify/evidencePackage.ts:628-633`,
  `:640-645`).
- `verify.sh` and `VERIFY.md` read tokens through `VERIFY_RECIPES.signedTokenFilter`, which keeps
  `subject` absent or `content` (`src/main/services/verifyProcedure.ts:78-81`,
  `src/main/services/verifyScript.ts:660-666`, `src/main/services/verifyRunbook.ts:347-349`).
- Export encloses a token file only where `stampFor` accepts the entry
  (`src/main/services/export.ts:1393-1403`, `:1927-1942`).
- `tests/shared/verify/manifestSchema4.test.ts:272-341` pins the exclusion.

A receipt stamp in a chain today would pass through every reader unreported.

**Nothing writes one.** The writer's `timestamp` input has no `subject`
(`src/main/services/manifest.ts:653-665`). The worker stamps Content Hashes only: `stampCapture`
(`src/main/services/timestampWorker.ts:66-114`) and `stampExhibit` (`:121-168`).

**The session writes `merge` and stops there.** `pullFromPeer` appends one `merge` per session
that brought new entries (`src/main/services/sharing/session.ts:613-628`) and returns its index as
`SyncSessionResult.mergeIndex` (`:131-133`). `SyncSessionOptions` holds only `onPhase`
(`:137-139`). No production code calls `pullFromPeer`: a search of `src/` finds it only in
`session.ts`. The scheduler that will call it belongs to the sync service issue (#1881).

**Two places would misread a receipt stamp once one exists.**

- `verify.sh` counts content tokens only. For a package whose chain carries receipt stamps and no
  content token, it would print "the signed manifest carries no RFC 3161 token"
  (`verifyScript.ts:727`) and close with "The signed chain carries no RFC 3161 token"
  (`:844-846`). Both would be false.
- The Data screen's Manifest ledger labels every `timestamp` row `hash <first 12 hex>` and looks
  for an Exhibit by that hash (`src/renderer/components/data/ledgerModel.ts:46-47`, `:117-118`,
  `:153-154`). A receipt row would read as a content stamp of an Exhibit nobody can find.

## 3. Tasks

Tasks 1, 2, and 9 have no dependencies. Task 3 needs Task 2, Task 4 needs Tasks 1 and 3, and
Task 5 needs Task 4. Before Task 6 come Tasks 1, 2, and 4, and before Task 7 comes Task 2. Task 8
needs Task 7's test helper, and Task 10 comes last.

Tasks 3, 8, and 9 follow the answers to questions 2, 1, and 4 in section 13.

### Task 1. Let the writer accept `subject: 'entry'`

File: `src/main/services/manifest.ts`.

- The `timestamp` member of `ManifestEntryInput` (`:653-665`) gains `subject?: 'entry'`. Only
  `entry` is writable, because the schema omits `content` and never writes it
  (`schemas.ts:597-599`).
- `fieldMinReaderSchemaVersion` (`:874-881`) returns 4 for a `timestamp` that carries `subject`,
  through a constant beside `CAPTURE_EXHIBIT_NUMBER_MIN_READER` (`:868`) and
  `CAPTURE_EGRESS_MIN_READER` (`:872`). The writer then stamps 4 whatever the caller passes, which
  the schema requires (`schemas.ts:613-619`).
- `MIN_READER_SCHEMA_VERSION.timestamp` stays 2 (`:840`), so a content stamp keeps schema 2.

Tests in `tests/shared/verify/manifestSchema4.test.ts`:

- `appendManifestEntry` writes a `timestamp` with `subject: 'entry'` at schema 4, and the line
  parses under `ManifestEntrySchema`.
- The same call without `subject` writes schema 2 and no `subject` key, as before.

### Task 2. The receipt rule in verify-core

Files: `src/shared/verify/trustedTime.ts`, `src/shared/verify/index.ts`.

- Add `receiptStampFor(entry, entryHash)`, the counterpart of `stampFor` (`:57-79`). It returns a
  `TrustedTimeResult` when the record is a `timestamp` with `subject === 'entry'`,
  `captureContentHash === entryHash`, a string `tsaToken`, and a token whose imprint equals
  `entryHash`. Otherwise it returns undefined. Like `stampFor`, it reads lenient records.
- Add `receiptStampsFromEntries(entries)` over one chain's entries. It returns one record per
  `merge`: its index, its Entry Hash, and the first receipt stamp that binds it. It also lists the
  receipt stamps that name a `merge` and do not bind it, and the receipt stamps that name no `merge`
  in the chain.
- A receipt stamp binds a `merge` in its own chain only. The worker stamps only the `merge`
  entries of its own chain (Task 4).
- Export both from the barrel beside `stampFor` (`index.ts:72-77`).

Tests in a new `tests/shared/verify/receiptStamps.test.ts`, with tokens from
`buildSyntheticToken` (`tests/helpers/timestampFixtures.ts:29-58`):

- A receipt stamp over a `merge` entry's Entry Hash resolves `rfc3161`. The result carries the TSA
  name and time the token states.
- A token whose imprint is another hash, a token that does not parse, and a missing `tsaToken`
  each leave the `merge` unstamped, and each is listed.
- A receipt stamp naming a `capture` entry's Entry Hash, or a hash no entry has, is listed as
  naming no `merge`.
- `buildTrustedTimeIndexFromEntries` gives every Content Hash the same answer with and without the
  receipt stamp.

### Task 3. Read receipt stamps for the app

File: `src/main/services/trustedTime.ts`.

- Add `resolveReceiptStamps(caseDir)`. It reads the local chain with `readManifestSnapshot` and
  applies Task 2's rule. It reads no other chain, because a receipt stamp sits in the chain of the
  installation that wrote the `merge`.
- Add `pendingReceiptStamp(caseDir)`. It returns the newest `merge` after the local chain's last
  `import` when no receipt stamp binds it, and null otherwise. Entries before the last `import`
  belong to the source Case, by the rule the session (`session.ts:576-584`) and the Shared Case
  walk both apply.
- Put both after `buildTrustedTimeIndex` (`:168-173`), not at the end of the file, where #1811
  rewrites `reconcileAllMirrors` (section 8).

Tests in `tests/main/services/trustedTime.test.ts`, beside `trusted time in a Shared Case`
(`:305`):

- A chain with two `merge` entries and a receipt stamp on the first reports the first stamped and
  the second pending.
- A chain whose newest `merge` is stamped reports nothing pending, even with an older `merge`
  unstamped.
- A `merge` before the chain's last `import` is never pending.

### Task 4. The worker stamps a `merge`

Files: `src/main/services/timestampWorker.ts`, `src/shared/types.ts`, `src/renderer/lib/notify.ts`.

**`stampMerge(caseId, mergeIndex): Promise<boolean>`**

1. Return false when timestamping is declined (`timestampingEnabled`, `:54-56`).
2. Read the local chain through Task 3. Return false when the entry at `mergeIndex` is not a
   `merge`, and true when a receipt stamp already binds it.
3. Request a token over the Entry Hash with the same `requestToken` (`:59`, `:80`), and refuse a
   token whose imprint differs (`:81-84`).
4. Check again for a receipt stamp before appending, as `stampCapture` does against a concurrent
   attempt (`:85-91`).
5. Append `{ type: 'timestamp', caseId, captureContentHash: <Entry Hash>, subject: 'entry',
   timestamp, tsaToken, operatorId, operatorName, toolVersion }`. Task 1 stamps it 4.
6. On failure, log a new code, `timestampWorker.receipt_stamp_failed`, and return false. The
   existing code's label reads "Couldn't get a trusted timestamp for this capture"
   (`notify.ts:183`), which names the wrong thing. The new code joins `LOG_CODES` in
   `src/shared/types.ts`, beside `timestampWorker.stamp_failed` (`:692`), and gets a label in
   `CODE_LABELS` (`notify.ts:118`).

**`enqueueReceiptStamp(caseId, mergeIndex): void`** does what `enqueueExhibit` does (`:227-232`):
it returns when timestamping is declined, and otherwise calls `stampMerge` on `setImmediate`, so
nothing waits on the TSA.

**`processPending`** (`:189-206`) gains a third loop after the Exhibit loop. For each Case with a
roster (`listCaseMembers(caseId).length > 0`, the test `liveSyncSource` applies at
`session.ts:195`), it stamps `pendingReceiptStamp`. `start` (`:241-247`) then runs it at launch
and every five minutes, as it does for Captures.

Both new names join the `TimestampWorker` interface (`:34-45`) and the returned object
(`:254-263`). The new functions go after `enqueueExhibit`, and `processPending` changes only below
the Exhibit loop, clear of #1811's three hunks (section 8).

Tests in `tests/main/services/timestampWorker.test.ts`, with a recording `requestToken` and
`flushImmediate` (`:17-18`):

- `stampMerge` appends one receipt stamp and records one request, over the Entry Hash.
- A token whose imprint differs appends nothing.
- Two concurrent attempts append one receipt stamp, as `:143` tests for a Capture.
- With timestamping declined, `enqueueReceiptStamp`, `stampMerge`, and `processPending` make no
  request and append nothing, as `:180-261` tests for Captures.
- `processPending` stamps only the newest unstamped `merge` of a Shared Case, and makes no request
  for a Case with no roster.
- The content known-answer test (`:263-338`) passes unchanged. It pins that a content stamp
  carries no `subject` and keeps its token byte for byte.

### Task 5. The session hands its `merge` to the worker

Files: `src/main/services/sharing/session.ts`, `tests/main/services/sharing/syncPeers.test.ts`.

- `SyncSessionOptions` (`:137-139`) gains `enqueueReceiptStamp?: (caseId: string, mergeIndex:
  number) => void`. It is optional, like the `enqueueTimestamp?` dependency of the Capture
  Lifecycle (`src/main/services/captureLifecycle.ts:152`, wired at `src/main/index.ts:590`). A
  caller that leaves it out still gets the stamp from the retry loop within five minutes (Task 4).
- Straight after `result.mergeIndex = merge.index` (`:627`), call
  `options.enqueueReceiptStamp?.(caseId, merge.index)`. A session writes at most one `merge`
  (`:613-615`), so it hands over at most one.
- No production caller exists to wire. #1881's sync service passes the app's worker when it calls
  `pullFromPeer`, and the PR body says so.

Two-peer tests in `syncPeers.test.ts`. Bob's worker uses a recording `requestToken` that returns
`buildSyntheticToken` for the hash it is asked for. `pull` (`tests/helpers/syncPeers.ts:419-440`)
passes its options through, on `main` and after #1811, so the helper needs no change.

- **One stamp per `merge`.** Alice adds entries and Bob pulls. After two `flushImmediate` turns,
  the recorder holds exactly one hash, the Entry Hash of Bob's `merge`. Bob's chain holds exactly
  one `timestamp` with `subject: 'entry'`, at schema 4, past the `merge`'s index, and the Shared
  Case walk over Bob's replica still passes.
- **None without one.** A second pull brings nothing new: `mergeIndex` is null, the recorder gains
  nothing, and Bob's chain gains no entry.
- **Content stamps unchanged.** Bob ingests a Capture of his own and the worker stamps it. Its
  `timestamp` entry has no `subject` and schema 2. `buildTrustedTimeIndex` over Bob's Case gives
  every Content Hash the same answer before and after the receipt stamp lands.
- **Declined.** With `tsaEnabled: false`, a pull that writes a `merge` makes no request and
  appends no receipt stamp. Turning timestamping on and running `processPending` stamps that
  `merge` once.
- **Retry.** When the first session's request throws, the second session's `merge` is stamped, and
  `processPending` then makes no request for the first `merge`.

### Task 6. The known-answer test

The committed DigiCert token attests the digest of bytes nobody kept
(`tests/fixtures/timestamp/README.md`), so no `merge` entry can be made to hash to it. This task
commits a second real token, over the Entry Hash of a fixed `merge` entry.

**The fixed chain.** In a temporary storage root, under an invented Case id, `appendManifestEntry`
writes two entries with fixed, invented fields:

- index 0, a `capture` entry, so that the `merge` links to an entry before it;
- index 1, a `merge` with one head that names an invented installation id, index 0, an invented
  Entry Hash and `entriesReceived: 1`.

The Entry Hash covers the body without `signature` (`manifest.ts:910-915`), so the per-run test key
changes neither Entry Hash.

**The fixture files**, made once in `tests/fixtures/timestamp/`:

1. `merge-entry-hash.txt`: the `merge` entry's Entry Hash, printed by the test's chain builder.
2. `merge-request.tsq`: `openssl ts -query -digest <hash> -sha256 -cert -out merge-request.tsq`.
3. `merge-digicert-response.tsr`: DigiCert's reply to that request, sent as an HTTP POST to
   `http://timestamp.digicert.com` with `Content-Type: application/timestamp-query`, as the first
   fixture was.
4. `merge-digicert-token.der`: `openssl ts -reply -in merge-digicert-response.tsr -token_out -out
   merge-digicert-token.der`.
5. A README section recording these commands, the date, the responder certificate, the TSA time,
   and `Verification: OK` from `openssl ts -verify -in merge-digicert-response.tsr -queryfile
   merge-request.tsq -CAfile digicert-trusted-root-g4.pem`.

The directory's `.gitattributes` already marks `*.tsq`, `*.tsr`, and `*.der` binary. If the new
token does not verify against the committed DigiCert Trusted Root G4, stop and ask, because the
fixture would then need a second anchor.

**The test** is a new `describe` beside the content known-answer test in
`tests/main/services/timestampWorker.test.ts:263`:

- The `merge` that `appendManifestEntry` writes has the Entry Hash in `merge-entry-hash.txt`. This
  pins the writer's canonical body for `merge`, its schema 4 stamp, and its link to the entry
  before it.
- `stampMerge`, with a `requestToken` that returns `merge-digicert-token.der`, records one request
  over that hash. It appends a `timestamp` with `subject: 'entry'`, `captureContentHash` equal to
  the hash, `schemaVersion` 4, and a `tsaToken` equal to the token's base64, byte for byte.
- `verifyManifestChainText` passes the three-entry chain.
- `receiptStampsFromEntries` reports the `merge` as stamped. Its TSA name and time match what the
  README records from `openssl ts -reply -text`.
- `buildTrustedTimeIndexFromEntries` reports the `capture` entry's Content Hash `pending`, as it
  would with no receipt stamp.
- With timestamping declined, the same input makes no request and appends nothing.

Two more tests read the fixture:

- In `tests/main/services/timestamp.test.ts`, beside the `openssl ts -verify` tests (`:149`):
  `openssl ts -verify -digest <hash> -in merge-digicert-token.der -token_in -CAfile
  digicert-trusted-root-g4.pem` prints `Verification: OK`, and a copy with one byte flipped fails.
  Under `BIRDBRAIN_REQUIRE_OPENSSL=1` a missing `openssl` fails the run
  (`tests/helpers/openssl.ts:6`).
- In `tests/shared/verify/timestampTokenDerStrictness.test.ts`, beside `:56-120`: pin what
  `checkTimestampTokenDerStrictness` reports for the new token, and that `parseTimestampToken`
  reads it. #1142 found the `certificates` SET of DigiCert's token out of DER order. Pin what this
  token shows, not what the old one showed.

### Task 7. The package checker and the standalone verifier report receipt stamps

Files: `src/shared/verify/evidencePackage.ts`, a new `tests/helpers/receiptPackage.ts`,
`tests/shared/verify/evidencePackage.test.ts`, `tests/verifier/binary.test.ts`.

**The checker.** A new section after the Exhibit timestamp rows (`:967-1027`) walks the chains the
Exhibit Number rows walk: the exporter's chain when it verified, then each accepted member chain
(`numberedChains`, `:1036`). For each chain it applies Task 2's rule and adds:

- one `pass` row per receipt stamp that binds a `merge`, named `merge <index> receipt timestamp`,
  with ` in the chain of <key>` for a member chain, as the Exhibit Number rows name theirs
  (`:1039`). The reason gives the TSA name and time. It says the token anchors that `merge`
  entry's Entry Hash and no Exhibit's content, that the check is structural (imprint only), and
  that `openssl ts -verify` checks the TSA's signature, as the content rows say (`:925-931`);
- one `fail` row per receipt stamp that names a `merge` and whose token does not parse or attests
  another hash, as a content token in that state fails (`:918-923`);
- one `skip` row per receipt stamp that names no `merge` in its chain. No honest writer produces
  one, but its line's signature holds, so the row reports it and does not fail the package.

A `merge` with no receipt stamp gets no row. Every Shared Case package written before this change
holds `merge` entries without receipt stamps, so their reports do not change. Content rows do not
change either, because `timestampEntries` stays content-only (`:628-633`).

**The standalone verifier.** `src/verifier/cli.ts` prints every row the checker returns
(`:110-113`), so it reports receipt stamps with no code change. Its closing note sends the reader
to `VERIFY.md` for TSA authenticity (`:146-151`), which Task 8 makes true for receipt stamps.

**The fixture helper.** `tests/helpers/receiptPackage.ts` writes a two-member Shared Case package
by hand, as `tests/helpers/egressPackage.ts` does for the Egress fields, so the in-process checker
and the built binary read the same bytes. The Owner's chain holds both `member-add` entries, one
Exhibit, a `merge` naming the member's head, and a receipt stamp on that `merge` with a synthetic
token. Options write a wrong imprint, a receipt stamp naming no `merge`, and a receipt stamp in the
member's chain.

Tests in `tests/shared/verify/evidencePackage.test.ts`:

- The package passes, with one `merge <index> receipt timestamp` row whose reason names the
  synthetic TSA.
- Every other row equals the row for the same package without the receipt stamp.
- A wrong imprint fails the row and the package.
- A receipt stamp naming no `merge` adds a `skip` row, and the package passes.
- A receipt stamp in the member's chain is reported with ` in the chain of <member id>`.
- A receipt stamp past a break in the exporter's chain adds no row, because that chain did not
  verify.

Tests in `tests/verifier/binary.test.ts`: the built binary exits 0 on the helper's package and
prints the `[PASS] merge <index> receipt timestamp` line, and exits 1 on the wrong-imprint package
with the `[FAIL]` line. These run only after `pnpm build:verifier` (`binary.test.ts:27-33`).

### Task 8. `verify.sh` and `VERIFY.md` check receipt tokens

Files: `src/main/services/verifyProcedure.ts`, `src/main/services/verifyScript.ts`,
`src/main/services/verifyRunbook.ts`, `tests/main/services/sharedCaseExport.test.ts`.

**The recipe.** `VERIFY_RECIPES` (`verifyProcedure.ts:74-82`) gains `receiptTokenFilter`:
`select(.type == "timestamp" and .subject == "entry" and (.tsaToken | type) == "string")`. The
script and the runbook read it from there, as they read `signedTokenFilter`.

**`verify.sh`, step 6** (`verifyScript.ts:649-800`). After the content-token walks (`:673-708`),
add a receipt walk over the chain the script reads:

1. For each receipt stamp, take its imprint from `captureContentHash` and find the `merge` with
   that `entryHash`. Step 3 has already recomputed every `entryHash`. A receipt stamp that names
   no `merge` gets a `note`.
2. Decode the token from the signed line with `openssl base64 -d -A`, as the script does for
   signed tokens (`:757`).
3. Run `openssl ts -verify -digest <Entry Hash> -in <decoded> -token_in -CAfile "$TSA_ROOT"`,
   with `-untrusted` when `$TSA_INTERMEDIATES` exists (`:776-782`). Report a `note` on success and
   a `fail` otherwise, naming the `merge` entry's index.
4. Run the anchor checks (`:723-747`) when content tokens or receipt tokens exist, not only content
   tokens, and count receipt tokens in the INCOMPLETE line (`:732`).
5. Rewrite the lines that say the chain carries no token (`:727`, `:840-846`): when receipt tokens
   exist they say the chain carries no RFC 3161 token over any Exhibit's content, and state how
   many receipt tokens verified.

On `main` the script reads only `$MANIFEST_FILE`, so the walk covers the exporter's own `merge`
entries. #1864's branch replaces those reads with `$case_entries`, every chain the script verified
(section 8). After that rebase, the receipt walk reads `$case_entries` and covers every member's
receipt stamps. No `.tst` file is added, so the reverse pass (`:794-800`) needs no change.

**`VERIFY.md`, step 6b** (`verifyRunbook.ts:347-365`). Add a paragraph and one block, with no new
sub-step number:

- The paragraph says what a receipt stamp anchors and what it does not (section 7), that its token
  sits only in its signed line, and that its digest is the `merge` entry's `entryHash`, not a
  Content Hash.
- The block is a loop with no placeholders, so the runbook test helper (`runRunbookBlocks`) runs
  it as written. For each receipt stamp it finds the `merge`, decodes the token, runs
  `openssl ts -verify`, and prints `receipt OK: merge #<index>` or `RECEIPT FAIL: merge #<index>`.

Tests in `tests/main/services/sharedCaseExport.test.ts`. They replace the bundled root with a local
TSA's, through the `tsaTrust` mock `verifyRunbookExecution.test.ts:59-70` uses, and issue tokens
with `createLocalTsa` (`tests/helpers/localTsa.ts`). `ownerReplica`'s `extra` hook (`:245-272`)
appends a receipt stamp on the Owner's `merge`. They need `openssl` and `jq`, and
`BIRDBRAIN_REQUIRE_OPENSSL=1` with `BIRDBRAIN_REQUIRE_JQ=1` turns a missing tool into a failure, as
preflight does.

- `verify.sh` exits 0 and prints the receipt line for that `merge`.
- The runbook block prints `receipt OK`.
- With a receipt token from a second local TSA, `verify.sh` exits 1 naming the `merge`, and the
  block prints `RECEIPT FAIL`.
- A package whose only tokens are receipt tokens never prints that the chain carries no RFC 3161
  token.
- `tsa-intermediates.pem` carries the certificates the receipt token embeds. Export gathers them
  from every `timestamp` entry, receipt stamps included (`export.ts:1381-1392`, `:1995-2001`), and
  `verify.sh` relies on that, so the test pins it.
- Single-chain packages give the same `verify.sh` output as before, and
  `verifyRunbookExecution.test.ts` passes unchanged.

### Task 9. Label a receipt stamp on the Data screen ledger

File: `src/renderer/components/data/ledgerModel.ts`. Test in
`tests/renderer/components/ledgerModel.test.ts`.

- `targetOf` (`:46-47`) labels a `timestamp` with `subject: 'entry'` as a receipt for entry
  `<first 12 hex>`, and keeps the content label for every other `timestamp`.
- `entryNames` (`:117-118`) returns false and `targetExhibitId` (`:153-154`) returns null for a
  receipt stamp, because an Entry Hash names no Exhibit.
- Tests: a content row's label and target are unchanged, and a receipt row has the receipt label
  and no target.

### Task 10. Write the pull request body

- One line each for the four verifiers, from section 4.
- The section 6 statement on schemas and versions, and the section 7 evidence impact.
- In the findings list: the session's hand-off has no production caller until #1881, and the
  `merge` rate between two connected members (question 3).
- The checks preflight does not run, run by hand: `pnpm build:verifier` and the binary tests.
- This plan's status line moves to `done` with the PR number.

## 4. What reports the receipt stamp

| Verifier | Reports the receipt stamp | Test |
|---|---|---|
| Standalone verifier, `src/verifier/cli.ts` | Yes. It prints the checker's receipt rows, with no code change. | `tests/verifier/binary.test.ts` (Task 7) |
| Package checker, `src/shared/verify/evidencePackage.ts` | Yes. One row per receipt stamp, structural: the token's imprint against the `merge` entry's Entry Hash. | `tests/shared/verify/evidencePackage.test.ts` (Task 7) |
| `verify.sh`, from `src/main/services/verifyScript.ts` | Yes, under the recommended answer to question 1. It runs `openssl ts -verify` on each receipt token, decoded from its signed line. | `tests/main/services/sharedCaseExport.test.ts`, through `runVerifyScript` (Task 8) |
| `VERIFY.md`, from `src/main/services/verifyRunbook.ts` | Yes, under the same answer. Step 6b gives the by-hand loop. | The same file, through `runRunbookBlocks` (Task 8) |

Under option A of question 1, neither `verify.sh` nor `VERIFY.md` reports the receipt stamp, and
`verify.sh` still needs Task 8's step 5 wording fix.

## 5. Do packages carry receipt stamps?

Packages already carry the bytes. Export encloses the exporter's chain and every member chain byte
for byte (`export.ts:1407-1411`), and each receipt token sits base64-encoded in its signed line.
The open choice is whether a package also carries the token as a file, and whether `verify.sh` and
`VERIFY.md` check it.

**Recommendation: no new file. `verify.sh` and `VERIFY.md` check each receipt token from its
signed line, and `export.ts` does not change.** Reasons:

1. **A file copy adds no evidence.** The signed line already holds the token, and steps 2 and 3
   check that line's signature and Entry Hash. A `.tst` copy would need a path in the Package
   Layout, byte-binding to the line, and an `evidence.json` field, which bumps
   `EVIDENCE_INDEX_SCHEMA_VERSION` from 2 (`schemas.ts:1012`). All of it restates the signed
   line.
2. **The binary sends its reader to `VERIFY.md`.** Its closing note names `openssl ts -verify` in
   `VERIFY.md` as the TSA authenticity check (`cli.ts:146-151`). Once the binary reports receipt
   stamps, a runbook that cannot check them leaves that reader with no command to run.
3. **`verify.sh` must change anyway.** Its "carries no RFC 3161 token" lines become false for a
   chain whose only tokens are receipt stamps (section 2).
4. **`export.ts` stays out of this PR.** The briefs queue four other changes on it (`briefs:52`),
   and it already gathers receipt token certificates into `tsa-intermediates.pem`
   (`export.ts:1381-1392`).

Options A and C are in question 1.

## 6. Schemas and versions

None change.

- **Manifest schema.** `subject: 'entry'` has been in the schema since schema 4 (#1518), and the
  schema 4 verifier shipped in 1.0.1-beta.22 (`briefs:365-366`). Task 1 makes the writer stamp the
  receipt stamp 4, the version its field needs. `MANIFEST_SCHEMA_VERSION` stays 5, and ADR-0023's
  rule that the verifier ships before the writer already holds. A schema 3 verifier already stops
  with "verifier too old" at the `merge` before the receipt stamp, so nothing changes for it.
- **Database schema.** Receipt stamps get no mirror column. The worker reads pending receipt stamps
  off the Manifest, as it does for non-Capture Exhibits (`timestampWorker.ts:116-120`,
  `:170-187`). `LATEST_SCHEMA_VERSION` stays 39 (`src/main/services/db/core.ts:6`), and #1515
  takes no turn in the migration lane.
- **Case Archive version.** An archive carries the local chain and every member chain byte for
  byte (`src/main/services/caseArchive.ts:250`, `:253`). A receipt stamp is one more line that any
  schema 4 reader parses, so `CASE_ARCHIVE_SCHEMA_VERSION` stays 9 (`caseArchive.ts:121`).
- **`evidence.json`.** Under the recommended answer to question 1 the index gains no field, and
  `EVIDENCE_INDEX_SCHEMA_VERSION` stays 2.

## 7. Evidence impact

1. **Investigation need, baseline, and threat.** Another member's Captures carry Trusted Time only
   from that member's own stamps (#1713's rule, `src/main/services/trustedTime.ts:58-75`), and only
   when that member had a TSA configured and reachable. With a receipt stamp, the receiver's own
   TSA bounds the time by which the receiver held what it received. That bound does not depend on
   the author's clock or the author's TSA.
2. **Supported claim.** A receipt token that verifies under `openssl ts -verify`, over a `merge`
   entry's Entry Hash, shows the TSA saw that Entry Hash at the time the token states. An Entry Hash
   covers the entry's `prevHash`, and a `merge` names the `entryHash` of each head it received. So
   every earlier entry in the receiver's chain, and every entry up to each named head in the other
   members' chains, existed no later than that time. Changing any of them would change a hash the
   token attests. It does not show:
   - when an author captured anything, beyond a time by which the entry existed;
   - that the receiver first held those entries at that time and not earlier;
   - that the receiver's TSA is honest, or who sat at the receiver's machine;
   - anything about an Exhibit's bytes beyond what the chain already binds.

   It changes no Exhibit's Trusted Time, which stays the Content Hash rule in `CONTEXT.md:167-169`.
   The writing guide says a token "dates the content rather than proving the chain around it is
   intact" (`docs/agents/writing-guide.md`, "Claim discipline"). That stays true of content stamps.
   A receipt stamp is the first token Birdbrain writes over a Manifest Entry, and the PR says so.
3. **Evidence and custody effects.** Originals do not change. The receiver's chain gains one
   `timestamp` entry after each `merge` it stamps, signed by the receiver. Each request sends the
   TSA a SHA-256 and nothing from the Case. It does tell the TSA operator, and anyone on the path to
   the plain HTTP default `DEFAULT_TSA_URL` (`src/shared/constants.ts:87`), that this installation
   synced at that time. Content stamps already disclose capture times the same way.
4. **Verification and failure behavior.** The checker and the binary gain `pass`, `fail`, and
   `skip` rows for receipt stamps. `verify.sh` gains a failure for a receipt token that does not
   verify to the anchor. Content rows, content Trusted Time, and every verdict on a package
   without receipt stamps stay as they are. Task 6 is the known-answer test.

## 8. Hot files and the rebase

The briefs order `trustedTime.ts` and `timestampWorker.ts` as SC-1, then SC-2b and SC-4, and
`verifyScript.ts` and `verifyRunbook.ts` as SC-V, then SC-4 if packages carry receipt stamps
(`briefs:52`). This plan is based on `main` and expects two rebases.

| File | Must merge after | State | Rebase cost for #1515 |
|---|---|---|---|
| `trustedTime.ts`, `timestampWorker.ts` | SC-1 (#1713) | Closed by PR #1844 (008206b9), 2026-10-13 | None. #1515 builds on its resolution. |
| `timestampWorker.ts` | SC-2b (#1811) | Draft PR #1879, `feat/1811-received-entries` at 36ecaf34, based on 58997988 | #1811 edits `stampCapture` after `:79`, `stampExhibit` after `:125`, and `listPendingExhibits` (`:170-184`). Task 4 edits the interface, adds functions after `enqueueExhibit`, and edits `processPending` below `:204`. No hunk overlaps. |
| `trustedTime.ts` | SC-2b (#1811) | Same PR | #1811 replaces `reconcileAllMirrors` with `reconcileCaseMirrors` at the end of the file (`:195-208`). Task 3 adds after `:173`. No overlap. |
| `session.ts` | SC-2b (#1811) | Same PR | #1811 adds a required `receivedCaptures` to `SyncSessionOptions` (`:137-139`) and drops the options default (`:379`). Task 5 adds one optional member there, a one-line manual merge. Its hand-off at `:627` is clear of #1811's apply step after `:664`. |
| `verifyScript.ts`, `verifyRunbook.ts`, `verifyProcedure.ts` | SC-V (#1864) | `feat/1864-member-chains` at 713099a2, based on 58997988, draft PR #1880 | SC-V adds step 4a, adds `'4a'` to `VerifySubStep`, and switches step 6's token reads from `$MANIFEST_FILE` to `$case_entries`. Task 8's receipt walk sits beside those reads and moves to `$case_entries` on rebase. Task 8 adds no sub-step, so the `VerifySubStep` edit does not collide. Moderate. |
| `sharedCaseExport.test.ts` | SC-V (#1864) | Same branch, 247 lines added | Task 8 appends tests and adds one mock at the top. Small. |
| `export.ts` | #1814, #1815, then SC-4 if packages carry receipt stamps | Not changed under the recommended answer to question 1 | None. #1515 leaves the `export.ts` order. |
| `manifest.ts` | Not listed for SC-4 | Task 1 edits the `timestamp` input and `fieldMinReaderSchemaVersion` | #1815's PR #1876 does not touch `manifest.ts`. CE-P step 1 and SC-6 come later. Small. |

The branch `feat/1811-apply-received-entries` at 60891cfb holds the same ten commits on 03b3eded,
the copy from before the rebase onto 58997988. PR #1879 is the one to rebase onto. After #1811,
`syncPeers.test.ts` gains tests at the end on both sides. Its `pull` helper takes
`Partial<SyncSessionOptions>` and spreads it, so Task 5's option passes through.

## 9. Approval criteria

This plan does not meet the criteria of ADR-0016 for proceeding without approval, so it waits for
approval. It trips three:

- **Criterion 2, no blocking-tier file.** It edits `timestampWorker.ts`, `trustedTime.ts`,
  `manifest.ts`, `src/shared/verify/**`, `sharing/session.ts`, `verifyScript.ts`,
  `verifyRunbook.ts`, `verifyProcedure.ts`, and `src/renderer/components/data/**`, all on the
  blocking tier (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md:229-239`,
  `:279-281`, `:310`, `:324`).
- **Criterion 5, existing patterns only.** The retry rule (Task 3), the receipt rows (Task 7), the
  package answer (section 5) and the ledger label (Task 9) are new design. Questions 1 to 4 ask
  about them.
- **Criterion 6, at most 10 files.** About 30: 13 source files, about 12 test files, and 5 fixture
  files.

Criteria 1, 3, and 4 hold: no new dependency, no migration and no data deletion, and every step is
reversible with git. Task 6's one request to DigiCert publishes nothing. #1515 carries
`evidence-affecting`, so the PR also needs the maintainer's review and never auto-merges.

## 10. Risks

- **The `merge` rate.** Each `merge`, and now each receipt stamp, is a new entry to the other
  member, so two connected members write a `merge` in every session, and each `merge` costs one
  TSA request. Question 3 covers it.
- **The new DigiCert token may not chain to the committed root.** Task 6 stops and asks.
- **An older `merge` stamped only through a later one gets no row of its own** under question 2's
  recommended answer. The PR says why.
- **Nothing in production writes a `merge` until #1881.** Until then this change writes no receipt
  stamp in a user's chain.
- **SC-V's rebase moves the receipt walk** onto `$case_entries`, and Task 8's tests in
  `sharedCaseExport.test.ts` move with it.
- **The binary tests skip** unless `pnpm build:verifier` ran. Preflight runs `pnpm build` only
  (`scripts/preflight.mjs:259`).
- **Two requests can race for one `merge`**: the session's hand-off and a retry tick. The second
  appends nothing (Task 4, step 4), but its request is spent, as for Captures.

## 11. Decisions this plan takes

Each falls in an ADR-0015 class and rests on the code or a doc cited beside it.

1. **Entry shape.** A receipt stamp is a `timestamp` with `subject: 'entry'` and the Entry Hash in
   `captureContentHash`, stamped 4 by the writer's field rule (`schemas.ts:584-619`,
   `manifest.ts:864-881`).
2. **No new setting.** `tsaEnabled` governs receipt stamps too. The worker's comment calls that
   setting "exactly one answer to 'may this process contact a TSA'" (`timestampWorker.ts:49-56`),
   and decision 15 turns receipt stamps on by default when a TSA is configured.
3. **No mirror column.** Pending receipt stamps are read off the Manifest, as for non-Capture
   Exhibits (`timestampWorker.ts:116-120`).
4. **Optional hand-off.** `enqueueReceiptStamp?` follows `enqueueTimestamp?`
   (`captureLifecycle.ts:152`). If question 2 is answered with option c, it becomes required, as
   #1811 made `receivedCaptures`.
5. **A log code of its own**, because the existing label names a Capture (`notify.ts:183`).
6. **Rows only where receipt stamps exist**, with the content rows' statuses, over the chains the
   Exhibit Number rows walk (`evidencePackage.ts:865-935`, `:1036`).
7. **A receipt stamp binds a `merge` in its own chain only**, the only one the worker writes.
8. **Test tokens.** The known-answer test uses a real DigiCert token. Package tests use synthetic
   tokens and a local TSA, the split `tests/helpers/localTsa.ts` explains in its header. The
   package fixture helper follows `tests/helpers/egressPackage.ts`.
9. **No new runbook sub-step.** The receipt text goes in step 6b, so it adds nothing to
   `VerifySubStep`, which SC-V also edits.
10. **Placement.** New code sits clear of #1811's hunks (section 8).

## 12. Verification

From the issue: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then `pnpm preflight` at
head. The known-answer test needs `openssl`, the `verify.sh` tests need `openssl` and `jq`, and the
binary tests need the built verifier.

```bash
pnpm lint
pnpm typecheck
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/timestampWorker.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/main/services/timestamp.test.ts
pnpm test tests/shared/verify/receiptStamps.test.ts
pnpm test tests/shared/verify/evidencePackage.test.ts
pnpm test tests/main/services/sharing/syncPeers.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 BIRDBRAIN_REQUIRE_JQ=1 pnpm test tests/main/services/sharedCaseExport.test.ts
pnpm build:verifier
pnpm test tests/verifier/binary.test.ts
BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test
pnpm build
pnpm preflight
```

`pnpm test <path>` takes no `--` (`CLAUDE.md:9`).

## 13. Questions the maintainer answered

1. **Packages and receipt stamps.** Every package already holds each receipt token inside its
   signed Manifest line. Should `verify.sh` and `VERIFY.md` also check those tokens, and should the
   package carry them as files?
   - **A.** No file, and no check in `verify.sh` or `VERIFY.md`. Only the checker and the binary
     report receipt stamps. `verify.sh` still needs its "carries no RFC 3161 token" lines fixed.
   - **B.** No file. `verify.sh` and `VERIFY.md` decode each token from its signed line and run
     `openssl ts -verify` on it (Task 8). `export.ts` does not change.
   - **C.** Each receipt token also ships as a `.tst` file, which needs `export.ts`, a Package
     Layout path, an `evidence.json` field and an index schema bump, as well as Task 8.

   Recommended: **B**, for the reasons in section 5. The token bytes are already signed into the
   package, the binary sends its reader to `VERIFY.md` for the authenticity check, and B keeps
   this PR out of `export.ts`.

   Answer (2026-10-17): **B**. `verify.sh` and `VERIFY.md` check each receipt token decoded from
   its signed line; packages gain no file and `export.ts` is unchanged.
2. **Retry rule.** When a receipt stamp's request fails, or timestamping was off when the `merge`
   was written, which `merge` entries should the five-minute retry stamp later?
   - **a.** Every unstamped `merge` after the last `import`, one request each, as Captures are
     retried.
   - **b.** Only the newest `merge`, when it is unstamped.
   - **c.** None. The session's one request is the only attempt.

   Recommended: **b**. A stamp made now over the newest `merge` gives every older `merge` the same
   time bound that a stamp of its own, made now, would give it, because the newest `merge` entry's
   Entry Hash covers them through `prevHash`. Option a repeats that bound once per `merge`, and
   after an outage that could mean hundreds of requests (question 3). Option c loses the stamp for
   good on one failed request. The cost of b is that an older `merge` covered only by a later one
   gets no checker row of its own.

   Answer (2026-10-17): **b**. The retry loop stamps only the newest unstamped `merge`.
3. **The `merge` rate.** Each member's last `merge`, and now its receipt stamp, is a new entry to
   the other member. Two connected members therefore write a `merge` in every session, and with the
   design's 60-second timer (`...design.md:200-201`) each would request one token per connected
   peer per minute while the app is open. Should #1515 stamp every `merge`, as its acceptance
   criterion says, or skip a `merge` whose session received only `merge` and receipt `timestamp`
   entries?

   Recommended: **stamp every `merge`** as the criterion says, and put the rate in the PR's
   findings for the sync service issue (#1881). The scheduler sets the timer, and it is where the
   design's one-`merge`-per-session rule (decision 14) would change if sessions that bring only
   other members' `merge` entries should write none. Skipping stamps here would still leave the
   chain growing by one `merge` a minute per peer.

   Answer (2026-10-17): **stamp every `merge`**. The request rate goes in the PR's findings,
   pointed at the sync service issue (#1881), which owns the timer.
4. **The Data screen ledger.** Once receipt stamps exist, the Manifest ledger shows each one as a
   `timestamp` row labelled `hash <12 hex>`, the label a content stamp gets, and its target finds no
   Exhibit. Should this PR label it as a receipt (Task 9: three small edits in `ledgerModel.ts` and
   one test), or should a follow-up issue do it?

   Recommended: **this PR**. The issue asks for the receipt stamp to be reported distinct from a
   Capture's content stamp, and #1515 is the first change that writes one.

   Answer (2026-10-17): **this PR**. The Data screen's Manifest ledger labels receipt stamps as
   receipts.
5. **The DigiCert request.** Task 6 needs one real token: one HTTP POST to
   `http://timestamp.digicert.com` carrying the SHA-256 of an invented `merge` entry. Should the
   implementing session make that request and commit the response, or should you run the commands
   and commit the files?

   Recommended: **the implementing session**, recording the commands in the fixture README as the
   first DigiCert fixture's README does. The request carries no Case data, and the app makes the
   same request for every Capture. If the session has no network access, it stops and hands you the
   commands.

   Answer (2026-10-17): **the implementing session** makes the one request, sending only the
   hash of an invented `merge` entry, and records the commands in the fixture README.
6. **Merge order.** Two unmerged changes edit files this one edits, and the briefs order both
   ahead of it: the change that writes received Captures into the database (#1811, draft PR #1879),
   and the change that makes `verify.sh` check every member chain (#1864, a branch with no PR yet).
   Should this change be built now on `main` and rebased onto each as it merges, or wait for both?

   Recommended: **build now and merge after both**, in the briefs' order. The rebase onto the
   received-Captures change is one manual line. The rebase onto the `verify.sh` change moves the
   receipt walk onto `$case_entries`. If the `verify.sh` change still has no PR when this one is
   green, ask again before merging ahead of it.

   Answer (2026-10-17): **build from `main` now**; merge after #1879 and #1880, with the
   orchestrator handling the rebases.
