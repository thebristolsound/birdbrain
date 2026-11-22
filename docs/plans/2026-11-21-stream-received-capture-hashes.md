# Stream the hashes of a received Capture's unused files

**Status:** active. The maintainer approved this plan with the recommended answer to each open
question, in the T3 thread for this branch on 2026-11-22; see "Decisions" at the end.

**Date:** 2026-11-21

**Issue:** [#2250](https://github.com/thebristolsound/birdbrain/issues/2250). Background: pull
request 2245, merged as `93f4dc9a`, whose review fleet raised findings F1 and F3
([review comment 7038024221](https://github.com/thebristolsound/birdbrain/pull/2245#issuecomment-7038024221)),
and [the reply on that pull request](https://github.com/thebristolsound/birdbrain/pull/2245#issuecomment-7068327557)
that deferred both as a follow-up.

**Frame of reference:** `origin/main` at `93f4dc9a`. Line numbers are at that commit.

## Problem

`planCapture` in `src/main/services/sharing/receivedEvidence.ts` passes up to five files to
`readAnchored` (lines 237-246): the page, the screenshot, the text, the Transaction Record,
and the PDF. `readAnchored` (lines 189-206) reads each one with `readFile`, hashes the buffer and
pushes it into `bytes`, which lives until `planCapture` returns. `planCapture` then uses only the
page, for the title (line 249), and the text, for `textContent` (line 250). At the caps in
`src/shared/constants.ts` (`MAX_MHTML_SIZE` 200 MiB, `MAX_SCREENSHOT_SIZE` 100 MiB,
`MAX_PDF_SIZE` 100 MiB, and the Transaction Record budget `TRANSACTION_RECORD_TOTAL_BYTES` of
50 MB), one received Capture holds about 450 MB in the main process.

Verification hashes the Transaction Record and the PDF as they stream: `verifySidecars` calls
`store.hashArtifact` for both (`src/main/services/captureLifecycle.ts:862-863`), and its comment
at lines 839-840 gives the reason.

## Approach

### Which files stream

`planCapture` hashes the three files whose bytes it never uses with `store.hashArtifact`, the
call verification makes: the Transaction Record (`warc.gz`), the PDF (`pdf`), and the screenshot
(`png`). It reads the page and the text whole, as today, because the title and `textContent`
come from them. It hashes those two from the same buffer it builds the row from, so the row
never takes its title or text from bytes other than the ones checked.

The screenshot streams too. The row records only its path (`screenshotPath: png?.rel`, line
259), its cap is 100 MiB, and `hashArtifact` takes the `png` type. Verification still reads the
screenshot whole (`streamed: false`, `captureLifecycle.ts:847`); this change leaves verification
alone.

After the change, a received Capture holds its page and its text whole, plus one read-stream
chunk at a time for each streamed file (64 KiB, the `fs.ReadStream` default). At the caps that
is about 200 MiB plus the text, down from about 450 MB.

The helpers checked before choosing:

- **`store.hashArtifact`:** The only exported function that hashes a file as it streams
  (`src/main/services/captureStore.ts:146-152`, body at lines 400-408). It takes a Capture id
  and an artifact type, so it fits a Capture's files and not an Exhibit's or a Derived File's
  path.
- **Private `hashFile(path)` copies:** Three modules stream a file by path in a function of their
  own: `captureStore.ts:389` (inside `createCaptureStore`), `src/main/services/exhibits.ts:269`,
  and `src/main/services/staging.ts:113`. None is exported, and all three modules are
  blocking-tier, so exporting one would add a second blocking-tier file to the change.

No new helper is needed.

### `readAnchored` after the change

A file may carry a `streamHash` function. `readAnchored` hashes a file that has one through it,
and reads a file without one whole, hashes it, and returns its bytes. The loop takes the shape
`verifySidecars` already uses (`captureLifecycle.ts:859-867`, the `if (streamed)` branch at line
862). Sketch, not final code:

```ts
// The bytes of each anchored file read whole, in order, or 'absent' while one has not arrived,
// or 'mismatch' after reporting it. Absence is checked for every file before any is hashed. A
// file with `streamHash` is hashed as it streams from disk, and its bytes are never held.
const readAnchored = async (
  files: Array<{
    rel: string
    abs: string
    hash: string
    streamHash?: () => Promise<string | null>
  }>,
  author: string,
  index: number
): Promise<Buffer[] | 'absent' | 'mismatch'> => {
  if (files.some(({ abs }) => !existsSync(abs))) return 'absent'
  const bytes: Buffer[] = []
  for (const { rel, abs, hash, streamHash } of files) {
    let actual: string | null
    if (streamHash) {
      actual = await streamHash()
    } else {
      const read = await readFile(abs)
      actual = sha256(read)
      bytes.push(read)
    }
    if (actual === null) return 'absent'
    if (actual !== hash) {
      refuse('hash-mismatch', author, index, `${rel}: expected ${hash}, found ${actual}`)
      return 'mismatch'
    }
  }
  return bytes
}
```

In `planCapture`:

```ts
// Hashed as they stream from disk, as verification hashes the record and the PDF: the row uses
// none of these files' bytes, so none is held whole.
const streamed = (type: CaptureArtifactType, hash: string) => ({
  ...artifact(type, hash),
  streamHash: () => store.hashArtifact(caseId, id, type)
})
const mhtml = artifact('mhtml', entry.contentHash)
const png = entry.screenshotHash ? streamed('png', entry.screenshotHash) : undefined
const txt = entry.textHash ? artifact('txt', entry.textHash) : undefined
const record = entry.transactionRecordHash
  ? streamed('warc.gz', entry.transactionRecordHash)
  : undefined
const pdf = entry.pdfHash ? streamed('pdf', entry.pdfHash) : undefined
const files = [mhtml, png, txt, record, pdf].filter((file) => file !== undefined)
const bytes = await readAnchored(files, author, index)
if (!Array.isArray(bytes)) return null
// Only the page and the text are read whole, in that order.
const [page, text] = bytes
const title = readMhtmlTitle(page) ?? entry.url
const textContent = txt ? text.toString('utf-8') : undefined
```

The absence check and `hashArtifact` resolve the same path: `artifact` spreads
`store.artifactPaths(caseId, id, type)`, and `hashArtifact` calls the same function with the
same arguments (`captureStore.ts:405`).

### What stays the same

- **Absence first:** The check at line 194 still runs over every file before any is read or
  hashed, so no file is opened while another is absent.
- **Order:** Files are still hashed page, screenshot, text, Transaction Record, PDF, and the
  first mismatch ends the loop. A Capture with two bad files names the same file it names today.
- **Refusal:** A mismatch still reports kind `hash-mismatch` with the detail
  `<rel>: expected <hash>, found <actual>`, returns `'mismatch'`, and writes no row. In both
  branches `<actual>` is the SHA-256 hex digest of the whole file on disk.
- **Row content:** The title still comes from the page's bytes and `textContent` from the text's
  bytes. Only the index the text is read from changes, from `bytes[files.indexOf(txt)]` to the
  second read buffer.

### A file that disappears after the absence check

`hashArtifact` checks for the file itself and returns `null` when it is absent
(`captureStore.ts:406`). After the absence check, `null` can only mean that the file was
removed between that check and its hash. Today the same race makes `readFile` reject with
`ENOENT`: `applyReceivedEvidence` rejects, `session.ts:746` reports a `local` error ("received
evidence could not be applied"), and none of the session's received rows is written.

The plan returns `'absent'`, the outcome the absence check gives for the same files on disk. That
Capture gets no row and no error, the session's other rows land, and the next session asks for
the file again, because `missingAnchoredFiles` (`blobAcceptance.ts:180`) requests any anchored
file not on disk. Either way the Capture gets no row, so nothing that fails today starts
passing. Keeping today's outcome instead would mean throwing on `null`; decision 2 chose to wait.

### The other two callers

`planExhibit` (lines 299-303) and `planDerivation` (line 345) pass no `streamHash`, so each still
reads its one file whole, and neither call site changes. Neither uses the bytes. They stay as
they are because:

- Each call holds one file and drops it when the function returns, so bytes do not build up
  across files the way a Capture's five do.
- Their paths come from `safeCasePath`, not from the Capture Store, so `store.hashArtifact`
  cannot hash them.
- Streaming them would mean exporting one of the private `hashFile` functions from a second
  blocking-tier module.

Decision 3 keeps them out of this change.

### The comment at line 240

It changes. "Read for their hash only: the row holds neither file's bytes" is true of the row and
false of memory. The comment above `streamed` in the sketch replaces it and covers the
screenshot, the record, and the PDF. The `readAnchored` comment at lines 187-188 also changes, to
say which files' bytes it returns.

## Evidence impact

`receivedEvidence.ts` is blocking-tier
([evidence-affecting paths assessment](../specs/2026-07-31-evidence-affecting-paths-assessment.md),
its row in the path table): it decides which received Captures this replica lists. The pull
request therefore carries an Evidence impact section and a known-answer test, and must not stop
an earlier package from verifying (ADR-0004, ADR-0014).

- **Result that could change:** None is intended. The same files are hashed with SHA-256 against
  the same signed entry fields, in the same order, with the same refusal. For three files, only
  the way their bytes reach the hash changes.
- **What the check proves after the change:** The same as before. A received row is written only
  when every file its entry anchors is on disk and hashes to the value its author's chain states.
  The check does not show the page was genuine, and a file can still change on disk after the
  check, as it can today.
- **Backward verification:** No entry, manifest, file format, schema, or export changes, and
  `verifyCapture` is untouched, so packages exported earlier verify as before.
- **Known-answer tests:** The tests in the next two sections.

### Tests that pin this path today

All of these passed at `93f4dc9a` on 2026-11-21, run one file at a time with
`BIRDBRAIN_TEST_SYSTEM_SHARP=1 pnpm test <path>`: `receivedEvidence.test.ts` 35 passed,
`captureRowKnownAnswers.test.ts` 1 passed, `syncPeers.test.ts` 43 passed.

- **`tests/main/services/sharing/receivedEvidence.test.ts:335`** ("writes no row while a file is
  missing or fails its hash, and writes it once it arrives"): a screenshot written on the
  receiver, which the file step never fetches again, draws `hash-mismatch` naming
  `<png rel>: expected <screenshotHash>` and no row; the row lands once the genuine file is in
  place.
- **`receivedEvidence.test.ts:382`** ("writes no row while its Transaction Record or PDF is
  missing or fails its hash (#2206)"): an absent record or PDF gives no row and no error; a
  record or PDF written on the receiver draws a mismatch for that file and no row; with every
  file genuine the row lands and `verifyCapture` returns status `verified`.
- **`receivedEvidence.test.ts:185`** ("takes its title from the received MHTML") and **`:194`**
  ("is found by Case search through a word only its received text holds"): pin that the title
  and `textContent` come from the page and text bytes, which the new `[page, text]` read touches.
- **`tests/main/services/captureRowKnownAnswers.test.ts:245`** ("matches the answers recorded
  before the mapping moved"): pins every column of the received rows and their `captureTexts`,
  including the background Capture, which carries a screenshot, text, a Transaction Record, and
  a PDF (`tests/fixtures/captureRow/known-answers.json:922-926`). Reading `textContent` from the
  wrong buffer fails here.
- **`tests/main/services/sharing/syncPeers.test.ts:601` and `:628`:** the file step's refusal of
  a record and a PDF altered in transit. That is `blobAcceptance.ts`, not this path, and it does
  not change; it is listed because it is the step before.

The tests that fail if the hash check is weakened are the receiver-written steps of `:335` and
`:382`. A file already at its path is never fetched again, so only the apply step's hash can
refuse it. If `readAnchored` stopped comparing a streamed file's hash, the row would land, and
`expect(local.errors).toEqual([mismatch(...)])` would fail. If a streamed hash read the wrong
file, the final pull of `:382` would report a mismatch where it expects none.

### Showing the bytes are no longer held

A heap measurement in a test would be noisy, so the tests show the mechanism instead:

- **No whole read:** `vi.mock('fs/promises')` passes through to the real `readFile`, wrapped in
  `vi.fn` (the pattern at `tests/main/services/mhtmlParts.test.ts:20-23`). The test asserts that
  during the pull `readFile` is called with the page and text paths and never with the
  screenshot, record, or PDF paths.
- **Streamed hash:** `vi.spyOn(defaultCaptureStore, 'hashArtifact')` (the pattern at
  `tests/main/services/export.test.ts:4952`) shows it was called once for each of `png`,
  `warc.gz`, and `pdf` for the Capture. The assertion runs before `verifyCapture`, which calls
  `hashArtifact` too.

Together these show that nothing reads those three files whole on this path; `hashArtifact`
holds one chunk at a time by construction. Peak memory itself is not measured.

## Test shape

All in `tests/main/services/sharing/receivedEvidence.test.ts`, under one new `describe` for
#2250, with the `fs/promises` passthrough mock at the top of the file:

1. **Streams three files and lands the row.** A takes a Capture whose screenshot, Transaction
   Record, and PDF are each 200 KiB plus 1 byte of invented bytes, so each spans several stream
   chunks and ends in a partial one. The test first asserts that the entry's three hashes equal
   its own `sha` of those bytes, a known answer computed outside the code under test. B pulls;
   the row lands, the two spies show what the previous section names, and `verifyCapture` returns
   `verified`. A stream that hashed fewer than all its chunks would refuse the row. Fails at
   `93f4dc9a`, where `readFile` reads all three.
2. **Checks absence before hashing.** A wrong screenshot written on B, with the PDF withheld from
   the source: no error, no row, and neither spy records a call for that Capture's files. When the
   PDF arrives, the next pull reports the mismatch on the screenshot with the full detail. Passes at
   `93f4dc9a`: it pins behaviour that must not change.
3. **Waits on a file that disappears mid-check.** The first `hashArtifact` call for the PDF
   removes it from disk before hashing, so the real call returns `null`: no error, no row. The
   next pull fetches the PDF again and lands the row. Fails at `93f4dc9a`, where `hashArtifact` is
   not called on this path. Its expectation follows decision 2.

The existing `mismatch` helper in the `:382` test and the receiver-written step of `:335` are
tightened to assert the whole detail, `found ${sha(<written bytes>)}` included, so the reported
hash is pinned as the SHA-256 of the file on disk. These edits make two assertions stricter and
loosen none.

`captureRowKnownAnswers.test.ts` and its fixture do not change. The received rows must come out
byte-identical, so any fixture diff would be a regression.

One mutant is equivalent: in the `null` branch, `return undefined` in place of `return 'absent'`
leaves `planCapture` returning `null` either way, because it tests only `Array.isArray`. The test
reliability probe may report it as a survivor.

## Files to change

- **`src/main/services/sharing/receivedEvidence.ts`:** `readAnchored`, the file list in
  `planCapture`, the `[page, text]` read, and the two comments.
- **`tests/main/services/sharing/receivedEvidence.test.ts`:** the passthrough mock, the new
  `describe`, and the two tightened details.
- **This plan:** its status line, once the pull request opens.

Unchanged: `captureStore.ts`, `captureLifecycle.ts`, `blobAcceptance.ts`, `session.ts`, and the
known-answer fixture.

## Verify steps

1. Once per worktree on the maintainer's machine, run
   `env -u PKG_CONFIG_PATH pnpm build:test-sharp`. The shell's `PKG_CONFIG_PATH` points at a
   home-built `libvips` linked to a removed OpenEXR, and the first test run for this plan failed
   to load `libOpenEXR-3_4.so.33` until the test build of sharp was rebuilt this way.
2. Write tests 1 and 3 first and run
   `BIRDBRAIN_TEST_SYSTEM_SHARP=1 pnpm test tests/main/services/sharing/receivedEvidence.test.ts`.
   Both must fail at `93f4dc9a` for the reasons given above.
3. Make the source change, then rerun that file, `captureRowKnownAnswers.test.ts`, and
   `syncPeers.test.ts`.
4. Run `pnpm check` between edits.
5. Commit, then run `pnpm test:reliability` on the clean tree and read each surviving mutant.
6. Run `BIRDBRAIN_TEST_SYSTEM_SHARP=1 pnpm preflight` at head; its `.preflight/verification.md`
   goes in the pull request body.
7. Open the pull request with the Evidence impact section's four fields and the
   `evidence-affecting` label. It then needs the maintainer's approval at head (ADR-0041) and
   the review fleet's status.

## Out of scope

- **Arrival:** `acceptBlob` (`blobAcceptance.ts:106-131`) takes each arriving file as one
  `Uint8Array` and reads the partial file back whole to hash it (line 123), so each file sits
  whole in memory as it arrives, one at a time, up to `MAX_BLOB_BYTES` (200 MiB,
  `src/main/services/sharing/messages.ts:22`). That is a separate question in another
  blocking-tier module.
- **The page and the text:** They stay whole, because `readMhtmlTitle` takes a `Buffer` and the
  row stores the text.
- **Verification:** Its whole reads of the screenshot and text (`captureLifecycle.ts:847-848`)
  stay as they are.
- **Finding F2 of the same review:** Building the file list from `CAPTURE_ENTRY_HASH_FIELDS` was
  deferred separately in the same reply.

## Decisions

The maintainer took the recommended answer to each of the three open questions below, in the T3
thread for this branch on 2026-11-22.

1. Should the screenshot stream too? The issue names only the Transaction Record and the PDF.
   **Decided: yes.** The row uses only its path, it can reach 100 MiB, and `hashArtifact` covers
   it with no extra code.
2. If a file disappears between the absence check and its hash, should that Capture wait without
   an error (as when the file never arrived) or fail the session's whole apply step with a
   `local` error, as it does today? **Decided: wait.**
3. Should the Exhibit and Derived File checks also stream, which means exporting one of the
   private `hashFile` functions from a second blocking-tier module? **Decided: no.** They stay as
   they are; a later change can stream them if wanted.
