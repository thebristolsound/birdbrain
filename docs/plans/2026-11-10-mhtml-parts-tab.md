# MHTML Parts tab on the Data screen

**Status:** active

This plan adds the **MHTML Parts** tab to the Data screen for [#991](https://github.com/thebristolsound/birdbrain/issues/991). The tab lists the parts inside a Capture's stored `.mhtml` file, using the walker the app's own checks already read, and shows a SHA-256 for each part that the tab computes when it reads the file. It writes nothing. Code references are to `origin/main` at `a1762414`.

## Context

The standalone mock gives the Data screen five tabs: Extracted Text, MHTML Parts, Headers & TLS, Manifest Ledger, and Properties (`docs/design-handoff/2026-08-10-birdbrain-prototype/Case Reviewer.dc.html:731-735`). Ruling W1 split the Parts tab out of #803 into #991, because W1 read the tree as having no MIME parser and the tab as needing either a streaming walker or a new dependency (`docs/plans/2026-08-25-wave4-intake-rulings.md:18-24`). #803 then shipped the Data screen without the tab, and the completion plan left it absent while #991 was open (`docs/plans/2026-09-14-data-explorer-completion.md:32-34`). The [deferral of 2026-08-30](https://github.com/thebristolsound/birdbrain/issues/991#issuecomment-5467635884) tied the walker and hash rulings to the Exhibit model's `document` kind.

The [decision of 2026-11-09](https://github.com/thebristolsound/birdbrain/issues/991#issuecomment-6752515052) unblocks the work. Its grounds note that `listHtmlPartsInMhtml` (`src/main/services/mhtmlDecoder.ts:53`) is already a dependency-free multipart walker, so W1's premise is stale. #803 and #1150 are closed, and `src/renderer/components/dashboard/cases/DataExplorer.tsx` builds the tab strip at `:487-560`.

Two premises in the issue body no longer hold:

- "Nothing in the tree parses MIME today." The decision's grounds correct this.
- "Whichever route is chosen has to stream." The decision chose a buffer read with a size limit. Acceptance criterion 2 still asks for enumeration without reading the whole file into memory, which contradicts the decision. Open question 1 asks how to settle that.

## Decisions already taken

- **The 2026-11-09 decision** ([comment](https://github.com/thebristolsound/birdbrain/issues/991#issuecomment-6752515052)). The maintainer asked a Claude Code session on 2026-11-09 to decide the open questions on the reopened issues, and the comment records the result for #991:
  - the tab reuses the archive reader in `mhtmlDecoder.ts`, so it shows the parts the checks read;
  - no new dependency;
  - the tab reads the archive into a buffer, under a size limit;
  - display only: no Derived Files, and no wait for the `document` kind;
  - each part's hash is computed when shown, over its raw bytes;
  - the design is written as a plan first, which is this file.
- **Ruling R6** (`docs/plans/2026-08-24-wave3-phase2-intake-rulings.md:171-178`):
  - the hash column is computed at display time over the raw encoded bytes and labelled `SHA-256 (computed now)`;
  - one line states that only the whole MHTML file is anchored in the manifest;
  - no shield icon and no use of the word "verified";
  - the part menu's **Verify against manifest** item is dropped;
  - the mock's caption is replaced wholesale;
  - the work splits into readers, IPC and known-answer tests first, then the screen; every branch keeps `evidence-affecting`;
  - (d) puts the deferred context-menu kinds in a later branch.
- **Mock correction items 8 and 9** (`docs/specs/2026-08-23-standalone-mock-corrections-brief.md:239-246`) restate R6 against the mock's caption (`Case Reviewer.dc.html:266`) and its part menu.
- **ADR-0023.** The [cross-reference of 2026-08-30](https://github.com/thebristolsound/birdbrain/issues/991#issuecomment-5467297246) records that a part is neither an Exhibit nor a Derived File but a view inside one Exhibit's bytes, so a part carries no anchored hash. ADR-0023 leaves extracting the images in an MHTML file to "a later per-Case opt-in derivation" (`docs/adr/0023-exhibits-are-the-unit-of-evidence.md:90-92`).
- **Superseded.** The completion plan's "MHTML Parts tab is absent" (`docs/plans/2026-09-14-data-explorer-completion.md:32`) no longer applies.

## Design

### Which rows get the tab

A Capture row gets the tab when its Capture has `format === 'mhtml'` and an `mhtmlPath` (`src/shared/types.ts:474`, `:506`). Verification applies the same test before it hashes the file (`src/main/services/captureLifecycle.ts:650`, `:659`). Legacy HTML Captures, pooled rows, Derived Files, and non-Capture Exhibits get no tab, because a tab with no data is absent (`DataExplorer.tsx:487`).

### Where the tab sits and when it reads

- **Order.** The tab follows the mock (`Case Reviewer.dc.html:732`). The new `tabs.push` goes between the Extracted Text block (`DataExplorer.tsx:491-507`) and the Headers & TLS block (`:508-515`).
- **Reads happen when the tab is shown, not only when it is picked.** `ArtifactTabs` mounts only the current tab's content (`src/renderer/components/data/ArtifactTabs.tsx:73`), and the current tab is the picked one or else the first (`:29`). A Capture with no extracted text therefore opens on MHTML Parts, and selecting its row reads the archive.
- **No read while the text loads.** While the extracted text is still loading (`DataExplorer.tsx:289-290`), the Parts tab would lead for a moment and start a read that the strip then drops. To avoid that, `DataExplorer.tsx` pushes the Parts tab only once the text query has settled. A failed text read counts as settled.
- **Hint.** The hint reads `read when shown`. It carries no part count, because a count would mean reading the file on every row click.
- **No cache.** The query keeps `staleTime: 0, gcTime: 0` for the reason `captureLinksQueryOptions` gives (`src/renderer/lib/api/captures.ts:39-48`): an answer kept by Capture id could outlive the archive it was read from. Reopening the tab reads again, so "computed now" stays literally true, and the tab has no separate **Read again** button.

### The listed state, top to bottom

1. **Archive card** (the mock's header card, `Case Reviewer.dc.html:245-249`):
   - the top-level Content-Type, the boundary, and the Snapshot-Content-Location;
   - `Parts: <N>`;
   - `File: <bytes> bytes, as read now`;
   - `Read at <local time>`.

   The mock's `Decoded size` becomes the stored file size, because the tab decodes nothing. The card shows no hash of the whole file: checking the file against its Content Hash stays with the pane header's **Verify** (`DataExplorer.tsx:558-561`), so the Data screen has one place that compares a file with its anchored hash.
2. **Banners**, shown only when they apply. Each one states a failure next to the list, so a partial list never reads as complete:
   - No closing delimiter: "The file ends without its closing boundary. The last part runs to the end of the file and may be cut short, so this list may be incomplete."
   - Row ceiling reached: "Listing stops at 5,000 of `<N>` parts."
   - Unterminated part headers: "`<K>` parts have no blank line ending their headers. Their type and encoding cannot be read, and the HTML readers skip them."
3. **Table.** The mock's columns (`Case Reviewer.dc.html:251-261`), with two added:
   - `#`: the part's position in the file, counting every part from 1.
   - `HTML part`: `part 0`, `part 1`, and so on, the index among text/html parts only (`src/main/services/htmlParts.ts:60-61`). Search hits and field hit checks print this number (`src/renderer/components/captures/LinksTab.tsx:45-47`, `src/renderer/components/captures/fieldHitCheckModel.ts:24-27`), so an Operator can find `part 2` from a search hit. The main document carries a `main` marker, chosen by the shared rule in the walker section. Other parts leave the cell empty.
   - `Content-Location`: plain text, never a link. Nothing in this tab navigates to a captured address.
   - `Content-Type`: the header value as stored.
   - `Encoding`: the Content-Transfer-Encoding as stored, or `(none)` when the header is absent.
   - `Offset`: the byte offset in the file where the hashed span starts.
   - `Size`: the span's length in bytes as stored, before decoding.
   - `SHA-256 (computed now)`: faint text, with no shield, no success color, and none of the words R6 rules out.
4. **Caption**, replacing the mock's caption (`Case Reviewer.dc.html:266`) wholesale: "Only the whole MHTML file is anchored in the manifest, and Verify checks it against its Content Hash. Each part's SHA-256 is computed now, over the part's bytes as stored before transfer decoding, and is not anchored."

The `Offset` column header carries a title that gives the recipe for checking a part outside Birdbrain: `tail -c +$((offset+1)) <file> | head -c <size> | sha256sum`. `website/content/docs/features.mdx` gets the same sentence.

### Header values

Header values come from attacker-controlled pages. Main cuts each value at 2,048 characters and sets `fieldsTruncated` on the row. The renderer model then writes every C0 control character, DEL, every C1 control character, U+00A0, and U+00AD as `\xNN`. The walker decodes headers as latin1 (`mhtmlDecoder.ts:82`), so every character is at most U+00FF, and that set covers every code point in the range that would otherwise render as nothing.

### What an Operator can do with a part

- **Allowed.** Each row has three inline copy buttons:
  - **SHA-256**, copied with the label `SHA-256 (computed now, not anchored)`, following `PropertiesTab.tsx:65`;
  - **Content-Location**, copied as main returned it, without the `\xNN` rewriting; the button is withheld when the value was cut at the field cap, because a cut value names nothing;
  - **Byte range**, copied as `offset <offset> length <size>`.

  All three go through `copyValue` (`src/renderer/components/data/copy.ts:7`), which copies the value unchanged and reports a denied clipboard. Inline buttons replace the mock's part menu, because R6 (d) moved the context-menu kinds to a later branch and this ticket adds no new menu kind.
- **Not offered.**
  - **Verify against manifest.** R6 and mock item 9 drop it: nothing per part is in the manifest.
  - **Open or save a part.** The decision says display only, and ADR-0023 reserves extracting the images in an MHTML file for a later opt-in derivation (`0023:90-92`). Saving part bytes outside the Case would hand the Operator bytes with no Manifest Entry and no Derivation. Open question 4 asks the maintainer to confirm this.

### States other than "listed"

Each state is a sentence in the tab. None of them hides the tab.

| Result | What the tab says |
|---|---|
| `file-missing` | "The stored MHTML file is not on disk at `<relative path>`." `readCaptureLinks` answers null for a missing file (`src/main/services/captureLinks.ts:149-150`). The Data screen is the integrity surface, so this tab states the absence instead. |
| `too-large` | "The stored file is `<X>` bytes, over the `<Y>`-byte limit this tab reads. Nothing was listed." |
| `no-mime-header` or `no-boundary` | "The stored file is not a multipart MHTML archive: it has no header block naming a boundary, so it holds no parts to list." One sentence covers both reasons, and tests assert the reason, not only the sentence. |
| `no-parts` | "The file names boundary `<B>` but holds no part delimited by it." |
| Main returned null | "This row has no stored MHTML to read." The renderer gate makes this unreachable in normal use. |
| The IPC call threw | The existing `ReadFailed` state with a **Retry** button (`DataExplorer.tsx:108-127`). |

### What main returns

New types in `src/shared/types.ts`, beside `CaptureLinks` (`:346-364`):

```ts
export interface MhtmlPartRow {
  position: number // 1-based, file order, every part
  htmlPart: number | null // index among text/html parts, as listHtmlPartsInMhtml numbers them
  mainDocument: boolean
  contentType: string | null
  transferEncoding: string | null
  contentLocation: string | null
  contentId: string | null
  offset: number // byte offset of the hashed span in the file
  size: number // bytes in that span
  sha256: string // over that span, computed at read time
  headersTerminated: boolean
  endsAtEndOfFile: boolean
  fieldsTruncated: boolean // a header value was cut at the field cap
}

export type MhtmlPartsRefusal =
  | { reason: 'file-missing'; path: string }
  | { reason: 'too-large'; size: number; limit: number }
  | { reason: 'no-mime-header' }
  | { reason: 'no-boundary'; contentType: string | null }
  | { reason: 'no-parts'; boundary: string }

export type MhtmlPartsListing =
  | { status: 'refused'; refusal: MhtmlPartsRefusal; readAt: string }
  | {
      status: 'listed'
      readAt: string
      fileSize: number
      topContentType: string | null
      boundary: string
      snapshotLocation: string | null
      closed: boolean
      totalParts: number
      unterminatedParts: number
      truncated: boolean // the row ceiling was reached, as CaptureLinks.truncated
      parts: MhtmlPartRow[]
    }
```

Refusals travel as data rather than as an `IpcFailure`, so the tab can word each one. Only unexpected I/O errors throw, and they reach the `ReadFailed` state.

### The hashed span

R6 asks for a hash over the raw encoded bytes. For a part with terminated headers, the span starts at the byte after the header blank line and ends before the line break that precedes the next delimiter. That is the span `encodedSize` already measures for the checks (`mhtmlDecoder.ts:86-90`, with `stripTrailingNewlineEnd` at `:203-207`). The span excludes the part's headers. For a part whose headers never end, the span starts after the delimiter line and ends at the same place, and the row says the headers are unterminated.

For the existing fixture `tests/main/services/fixtures/multi-part.mhtml` (1,086 bytes), the spans and hashes are:

| # | HTML part | Content-Type | Offset | Size | SHA-256 |
|---|---|---|---|---|---|
| 1 | 0, main | text/html, quoted-printable | 343 | 107 | `51e139ae51b1f7f100083f3536d21e615f4f25e831f15fe93abb93519265ce18` |
| 2 | | image/png, base64 | 584 | 12 | `929e08d597feae564ce98003c4a47ff5239a5b93681d186eda3a9871e5b62644` |
| 3 | 1 | text/html, base64, folded location | 796 | 62 | `d692e65d337705a1df44f2dbb2d64cd737f7f9cf9475343d9528b165357c79c1` |
| 4 | 2 | text/html, binary latin-1, `cid:` location | 1010 | 47 | `70f8f1e8349c1f9638ab19a7fda4e0ddcc9a9738dafd9acaec39d6a1ca544044` |

The closing delimiter starts at byte 1059, and a 2-byte epilogue (CRLF) follows it. These values were computed on 2026-11-10 with `tail -c +$((offset+1)) | head -c <size> | sha256sum`, outside the code under test. Part 2's hash also equals `printf 'iVBORw0KGgo=' | sha256sum`, which ties the span to the visible body text.

### Extending the walker without changing what existing callers see (PR A)

`listHtmlPartsInMhtml` (`mhtmlDecoder.ts:53-101`) parses every part's headers (`:79-82`) but keeps only text/html parts (`:83`). A display surface also needs to tell missing input from an empty list, and today the walker reports none of these:

- a missing top header block (`:55`) or boundary (`:60`), which return the same empty list as an archive with no HTML;
- a part with no header terminator, which it skips silently (`:80`);
- a missing closing delimiter, after which it reads to the end of the buffer with no signal (`:77`, `:96`).

**Change.**

- Factor the loop into one exported `walkMhtml(buffer, onPart)`. It calls `onPart` once per part, in file order, with `{ partStart, partEnd, bodyStart, bodyEnd, headersTerminated, html, contentType, transferEncoding, contentLocation, contentId }`. It returns `{ status, topContentType, snapshotLocation, boundary, closed, totalParts }`, where `status` is `'walked' | 'no-mime-header' | 'no-boundary'`. A callback keeps memory bounded by what the caller keeps: the Parts reader keeps 5,000 rows and only counts the rest.
- `listHtmlPartsInMhtml` becomes a projection of the walk:
  - it keeps only parts with `headersTerminated && html`;
  - it keeps the `?? '7bit'` default (`:84`), the `charset` rule (`:85`), and the lazy `decode` closure (`:91`);
  - it returns `{ snapshotLocation, parts: [] }` exactly where it does today (`:55`, `:60`).
- Header parsing stays in this file (`parseLocation` at `:186`, `parseHeader` at `:235`, `isTextHtml` at `:249`). With one parser, the `htmlPart` numbering is by construction the numbering that `src/main/services/investigation/claimCheck.ts:103-104` indexes and `htmlParts.ts:82` reads.
- **Main document.** Move the rule at `htmlParts.ts:83-87` into an exported `mainHtmlPartIndex(snapshotLocation, htmlParts)` in `mhtmlDecoder.ts`, and call it from `htmlParts.ts` and the Parts reader. The rule matches the Snapshot-Content-Location among HTML parts only and falls back to the first HTML part, so a plain `contentLocation === snapshotLocation` test on every part could disagree with the Links tab. `tests/main/services/captureLinks.test.ts` covers the move unchanged.
- **Bounded header search.** `findHeaderEndBuf` (`mhtmlDecoder.ts:191-201`) runs two `indexOf` searches from the part's start to the end of the buffer. Chrome writes CRLF line endings, so a `\n\n` pair does not normally occur in a saved archive, and the `lflf` search at `:196` scans to the end of the file for every part. Every caller pays this today on ordinary Captures, not only on crafted files: the cost is the number of parts times the file size. The fix searches only `buffer.subarray(partStart, partEnd)`. Results stay the same:
  - the check `partHeaderEnd <= partEnd` (`:80`) already discards any match past `partEnd`;
  - when a next delimiter exists, `buffer[partEnd]` is its first `-`, so no `\r\n\r\n` or `\n\n` can start inside the part and end past `partEnd`;
  - when none exists, `partEnd` is the buffer's length, and the search is unchanged.
- **Kept as is.** The delimiter match is not anchored to a line start (`:65`, `:76`), so a body that contains `--<boundary>` splits a part. Anchoring it would change what the checks read, and the decision's point is that the tab shows the parts the checks read.

**Callers and tests that must see no change:**

- `src/main/services/extraction/extractionSource.ts:10`, `htmlParts.ts:82`, `claimCheck.ts:103`, and `src/main/services/sharing/receivedEvidence.ts:243` through `readMhtmlTitle` (`mhtmlDecoder.ts:107-119`);
- the tests that pin empty-list behaviour (`tests/main/services/mhtmlDecoder.test.ts:17-24`, `:237-240`) and byte-for-byte extraction (`:169-190`).

### Main-side reader, limits, and IPC (PR B)

**New `src/main/services/mhtmlParts.ts`:**

- `listMhtmlParts(buffer, limits)` is pure, and the known-answer tests target it.
- `readMhtmlParts(capture, store = defaultCaptureStore, limits = MHTML_PARTS_LIMITS): Promise<MhtmlPartsListing | null>` reads the file and calls it. It returns null when the Capture is absent, or is not `format === 'mhtml'` with an `mhtmlPath`, which mirrors `captureLifecycle.ts:650`.
- **Read order:**
  1. Open `store.resolveAbsolute(capture.mhtmlPath)`, the path verification hashes (`captureLifecycle.ts:659`) and the Links tab reads (`captureLinks.ts:147`).
  2. ENOENT on open becomes `file-missing`. Any other error throws.
  3. `stat` the open handle. A file over `maxFileBytes` becomes `too-large` before any byte is read.
  4. Read the whole file through the same handle. If the buffer is over the limit, because the file grew after the stat, refuse again with `too-large`.
- **Limits:**
  - `maxFileBytes = MAX_MHTML_SIZE` (`src/shared/constants.ts:5`, 200 MB), the cap ingest writes under (`src/main/services/captureStore.ts:264`);
  - `maxRows = 5000`, as `CAPTURE_LINK_BUDGETS.maxRows` (`htmlParts.ts:31`); every part is still walked and counted, so `totalParts` is exact, and only listing and hashing stop at the ceiling;
  - `maxFieldChars = 2048` per header value, with `fieldsTruncated` set on the row.
- **Hashes.** One `createHash('sha256')` per listed span, over `buffer.subarray(offset, offset + size)`. The reader hashes no whole file and compares nothing with the Capture's Content Hash.

**IPC:**

- `src/shared/ipc.ts`: add `CAPTURES_LIST_MHTML_PARTS: 'captures:listMhtmlParts'` beside `:134`, and the contract entry `'captures:listMhtmlParts': { args: [captureId: string]; result: MhtmlPartsListing | null }` beside `:1060`.
- `src/main/ipcHandlers.ts`: register the handler beside the Links handler (`:1274-1277`) as `readMhtmlParts(captureRepo.getCapture(captureId))`.
- `src/preload/index.ts`: add `listMhtmlParts: bridge(IPC_CHANNELS.CAPTURES_LIST_MHTML_PARTS)` beside `:104`.
- `src/shared/birdbrainApi.ts`: add `listMhtmlParts(captureId: string): Promise<MhtmlPartsListing | null>` beside `:196`.

### Renderer (PR C)

- `src/renderer/lib/api/keys.ts`: add `captureMhtmlParts` beside `:17`.
- `src/renderer/lib/api/captures.ts`: add `captureMhtmlPartsQueryOptions` beside `:41-48`, with `staleTime: 0` and `gcTime: 0` and a comment giving the same reason.
- New `src/renderer/components/data/mhtmlPartsModel.ts`: the refusal and banner sentences, the caption, the column labels (including the exact `SHA-256 (computed now)`), the copy labels, and the `\xNN` rewriting. Byte counts use `formatBytes` (`src/renderer/components/data/dataTableModel.ts:306`), with the exact count in a title.
- New `src/renderer/components/data/MhtmlPartsTab.tsx`: the card, banners, table, and copy buttons.
- `DataExplorer.tsx`: the `tabs.push` and the settled-text gate described earlier.

## Evidence impact and backward verification

### Tier of every file touched

| File | Tier | Basis in `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` |
|---|---|---|
| `src/main/services/mhtmlDecoder.ts` | blocking | listed at `:310` |
| `src/main/services/mhtmlParts.ts` (new) | unlisted until named; add at blocking | No entry or glob names it, so later edits would not trip the backstop. It reads stored evidence bytes and states their structure and hashes. PR B adds a row to the "Capture lifecycle, storage, parsing, extraction" table (`:300`), dated as the `selectorMatch.ts` row was (`:88-92`). |
| `src/main/services/htmlParts.ts` | unlisted | PR A only swaps its inline rule for the shared call. The PR body names the file, and this change does not list it. |
| `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/ipcHandlers.ts`, `src/preload/index.ts` | advisory | `:406-409` |
| `src/shared/birdbrainApi.ts` | unlisted | typed bridge signature only |
| `src/renderer/components/dashboard/cases/DataExplorer.tsx` | blocking | `:369` |
| `src/renderer/components/data/MhtmlPartsTab.tsx`, `mhtmlPartsModel.ts` (new) | blocking | the `components/data/**` glob at `:370` matches them from their first commit |
| `src/renderer/lib/api/captures.ts`, `keys.ts` | excluded | `:448` |
| the assessment itself, `website/content/docs/features.mdx`, tests, fixtures, e2e | unlisted | |

Every PR carries `evidence-affecting` and owes the ADR-0004 obligations: an Evidence impact section, a known-answer test, and preserved backward verification. A blocking-tier PR gets human review and never auto-merges (assessment `:157-160`).

### Evidence impact statement for each PR

The change writes nothing. It changes no stored byte, Content Hash, Manifest Entry, export, or verifier, so Evidence Packages exported by earlier versions verify unchanged. What it changes is what the app states about a Capture's contents: the part boundaries, types, offsets, sizes, and hashes the tab shows. The known-answer tests pin those statements.

### Backward verification

- **Existing readers.** PR A's equivalence pins, taken at the commit before the refactor, prove that text extraction, the claim check, the Links tab, and the received-evidence title read the same parts, sizes, and decoded text as before. The digest test at `mhtmlDecoder.test.ts:169-190` keeps passing unchanged.
- **Stored data.** No schema migration, no new stored field, and no change to any package member, so nothing exported earlier needs a new verifier path.
- **Writes nothing.** A reader test asserts that a call leaves the Case directory's file list and modification times unchanged. The handler reads one Capture row and writes no database row.

## Release order

No field is new in any stored, signed, or exported record. `MhtmlPartRow`, `MhtmlPartsRefusal`, and `MhtmlPartsListing` are IPC result types that the same build both produces and reads, so no release has to ship a reader before a writer. The only ordering is the merge order A, then B, then C.

## Pull request slices

### PR A: `refactor(mhtml): walk every part of an archive`

- **Files:** `src/main/services/mhtmlDecoder.ts`, `src/main/services/htmlParts.ts`, `tests/main/services/mhtmlDecoder.test.ts`, new `tests/main/services/fixtures/mhtml-parts.mhtml`.
- **Tests:**
  - The first commit adds equivalence pins before any refactor. For `multi-part.mhtml`, the two synthetic news fixtures under `tests/main/services/extraction/fixtures/`, and the new fixture, they pin `snapshotLocation`, each HTML part's `[contentLocation, encodedSize, sha256(decode())]`, and `readMhtmlTitle`. A comment names the commit the values came from.
  - Hand-built buffers cover: an empty buffer; no boundary; a part with unterminated headers between two HTML parts, which must keep the old HTML-part numbering; a missing closing delimiter; and a delimiter inside a body.
  - After the refactor, `walkMhtml` parts with `headersTerminated && html` line up one to one with `listHtmlPartsInMhtml`.
  - A known-answer test pins the `multi-part.mhtml` table under "The hashed span" through `walkMhtml` offsets.
  - `pnpm test:reliability` runs on the branch.
- **Tier:** blocking.
- **Screenshots:** none, because nothing on screen changes.

### PR B: `feat(data): list an MHTML Capture's parts over IPC`

- **Files:** new `src/main/services/mhtmlParts.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/birdbrainApi.ts`, `src/main/ipcHandlers.ts`, `src/preload/index.ts`, new `tests/main/services/mhtmlParts.test.ts`, `tests/main/ipcHandlers.test.ts`, and `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` (the new blocking row). Nine files.
- **Tests (`tests/main/services/mhtmlParts.test.ts`):**
  - **Known answers over the new fixture.** The fixture holds six parts with a preamble and an epilogue, on the `example.com`, `example.org`, and `widgets.example` domains only:
    1. text/html, quoted-printable, at `https://example.com/report`, which is also the Snapshot-Content-Location;
    2. text/css, 8bit;
    3. image/png, base64, an invented 1x1 image;
    4. text/html, base64, with a folded Content-Location;
    5. image/gif, with a Content-ID and no Content-Location;
    6. text/html, binary latin-1, at a `cid:` location.

    For each part the test pins position, `htmlPart`, `mainDocument`, type, encoding, location, offset, size, and `sha256`, plus `totalParts` and `closed`. The expected hashes come from `tail` and `head` piped to `sha256sum`, recorded in a comment beside the constants, as the provenance comment in `tests/helpers/extractionKnownAnswers.ts:4-6` does.
  - **Malformed input,** built in the test from the fixture:
    - truncated inside part 4: `closed: false`, part 4 has `endsAtEndOfFile`, four parts listed;
    - the blank line removed from part 2's headers: `headersTerminated: false` and `unterminatedParts: 1`;
    - the top-level boundary removed: `no-boundary`;
    - an empty buffer, and a bare `<html>` page with no blank line: both `no-mime-header`;
    - a boundary with no part between delimiters: `no-parts`.
  - **The reader:**
    - null for a missing Capture and for a legacy one;
    - `file-missing` on ENOENT;
    - `too-large` with an injected small limit, asserted to happen before any byte is read;
    - the grew-after-stat refusal;
    - the row ceiling, with `totalParts` still exact;
    - the field cap and `fieldsTruncated`;
    - `mainDocument` agreeing with `readHtmlParts` on both fixtures;
    - the writes-nothing test.
  - **IPC** (`tests/main/ipcHandlers.test.ts`, beside `:922-926`): null for an unknown id and for a Capture with no MHTML, and `listed` for a Capture whose fixture file is written to its path as the download test does (`:982-986`).
  - `pnpm test:reliability` runs on the branch.
- **Tier:** blocking.
- **Screenshots:** none.

### PR C: `feat(data): MHTML Parts tab on the Data screen`

- **Files:** `src/renderer/components/dashboard/cases/DataExplorer.tsx`, new `src/renderer/components/data/MhtmlPartsTab.tsx`, new `src/renderer/components/data/mhtmlPartsModel.ts`, `src/renderer/lib/api/captures.ts`, `src/renderer/lib/api/keys.ts`, new `tests/components/MhtmlPartsTab.test.tsx`, new `tests/renderer/mhtmlPartsModel.test.ts`, `tests/components/DataExplorer.test.tsx`, `e2e/data-explorer.spec.ts`, and `website/content/docs/features.mdx` (add MHTML parts and the checking recipe to the Data screen bullet at `:212-214`). Ten files.
- **Tests:**
  - **Model** (`tests/renderer/mhtmlPartsModel.test.ts`): each refusal sentence, the three banners, the caption, the `\xNN` rewriting of every escaped code point, and the copy labels.
  - **Component** (`tests/components/MhtmlPartsTab.test.tsx`):
    - the exact column header `SHA-256 (computed now)` and the caption;
    - no `/verif/i` text in the table and no shield icon in the tab (the caption's "Verify" sentence is the one allowed match, asserted by text);
    - the `part N` and `main` markers;
    - the three copy buttons passing full values, and the Content-Location button withheld on a cut value;
    - Content-Location rendered with no anchor element.
  - **Strip** (`tests/components/DataExplorer.test.tsx`):
    - The stubbed `cap-a` has `format: 'mhtml'` but no `mhtmlPath` (`tests/renderer/dataFixtures.ts:105`, `:112-120`), so the expectation at `:204` stays `['Properties']` and now also pins that a Capture with no stored path gets no Parts tab.
    - The pooled row at `:415` is unchanged.
    - New cases: a Capture with an `mhtmlPath` shows `MHTML Parts`; with extracted text the strip leads with Extracted Text and calls `listMhtmlParts` only after the Operator picks the Parts tab; and no read starts while the text query is pending.
  - **End to end** (`e2e/data-explorer.spec.ts`):
    - Seed one more Capture whose `mhtml` is `mhtmlPage(url, html)` (`e2e/fixtures/seed.ts:52`, passed through `SeedCapture.mhtml` at `:77-78`, `:114`). Open MHTML Parts and expect one row with the seeded URL as its Content-Location, `text/html`, `binary`, the `main` marker, and the column label `SHA-256 (computed now)`.
    - The default seed's body is a bare HTML page with no header block (`seed.ts:133`), so open MHTML Parts on `alpha` and expect the not-a-multipart-archive sentence. The reason behind it is `no-mime-header`, which the reader tests pin.
- **Tier:** blocking.
- **Screenshots:** yes. Seed a Case through the `run-birdbrain` skill with the invented fixture and a truncated copy of it, and capture:
  - **before:** the Data screen strip with four tabs;
  - **after:** the listed state with the caption; the truncated-archive banner; the not-a-multipart-archive sentence; a row's copy buttons.

  Attach them through GitHub's file attachment, following "Screenshots for visual changes" in `.claude/skills/post-pr-body/SKILL.md:65`.
- **Mock divergences.** #708, which carried mock corrections back to the design side, is closed, so the PR body lists where the tab departs from the mock: stored size for `Decoded size`, the added `HTML part` and `Offset` columns, the replaced caption, inline copy buttons for the part menu, and no **Verify against manifest**.

Each PR stays at 10 files or fewer, adds no dependency or migration, and reverts with git alone. All three still wait for plan approval and a human merge, because each touches a blocking-tier file (ADR-0016).

### Decisions taken in this plan (ADR-0015 classes, open to veto)

- The hashed span is the existing `encodedSize` span (`mhtmlDecoder.ts:86-90`), headers excluded.
- The tab sits in the mock's position, reads when shown, waits for the text read to settle, and carries no count in its hint.
- The query is not cached (`staleTime: 0, gcTime: 0`), following `captureLinksQueryOptions`, and reopening the tab replaces a **Read again** button.
- The tab shows no hash of the whole file; the pane header's **Verify** owns that comparison.
- The file limit is `MAX_MHTML_SIZE`, and the row ceiling is 5,000, as `htmlParts.ts:31`.
- A missing file is a stated refusal, not an absent tab.
- `HTML part` uses the `part N` wording of `LinksTab.tsx:46`.
- The main-document rule moves into `mhtmlDecoder.ts` and both readers call it.
- The walker reports parts through a callback, so the reader's memory stays bounded by the row ceiling.
- The header search is bounded in PR A, covered by equivalence pins.
- Actions are inline copy buttons, with the copy label `SHA-256 (computed now, not anchored)` following `PropertiesTab.tsx:65`.

## Open questions for the maintainer

1. **The issue asks for something the decision ruled out.** The issue's second acceptance criterion asks for the parts to be listed without reading the whole file into memory, tested on a file near the 200 MB cap. The 2026-11-09 decision says the tab reads the file into memory under a size limit. Should the criterion be rewritten, and who edits the issue? *Recommended:* rewrite it to say that the tab refuses a file over `MAX_MHTML_SIZE` before reading any of it, proven by a test with a small injected limit, and let a session edit the issue body with a link to the decision comment once you approve the wording. Until then, PR C's closing description cannot match the issue.
2. **The size limit.** The tab refuses files over 200 MB, the same cap ingest uses, so every Capture the app stored fits and the refusal only fires for a file that grew or was replaced on disk. Do you want a lower limit for this tab, knowing it would refuse some real Captures? *Recommended:* no, keep 200 MB.
3. **Hashing the whole file on the tab.** The tab could also hash the file it read and say whether it still matches the Capture's Content Hash. That costs one more pass over up to 200 MB. It would also be a second place on the screen that compares a file with its anchored hash, while ruling R19 keeps verification state in one place so that two displays cannot drift apart (`docs/plans/2026-08-24-wave3-phase2-intake-rulings.md:166-168`). Should the tab do it? *Recommended:* no. The caption points to **Verify**, which already does this.
4. **Opening or saving a single part.** The tab lets an Operator copy a part's hash, location, and byte range, and nothing else. Saving a part's bytes would put evidence bytes on disk that no Manifest Entry covers. Should this ticket keep parts from being opened or saved? *Recommended:* yes, leave saving for the later opt-in derivation ADR-0023 describes.
5. **Uploaded `.mhtml` files.** An `.mhtml` that arrives as an uploaded Exhibit through the Staging Pool is not a Capture. Should it also get the tab? *Recommended:* no, Captures only for this ticket, because the decision deliberately does not wait for the `document` kind that would define such files.
6. **Reading on row selection.** A Capture with no extracted text opens on the Parts tab, so clicking its row reads the archive in the main process. Should the tab wait for a button press in that case? *Recommended:* no. The Links tab reads the whole file each time it is shown, the 200 MB limit bounds the work, and PR A removes the per-part scan to the end of the file.
7. **Changing the walker in this ticket.** PR A bounds the header search inside the walker that text extraction and the claim check depend on. It keeps their results, the equivalence pins prove that, and without it the size limit does not bound the walker's work. Is that change acceptable as part of #991? *Recommended:* yes.

## Verification

For each PR, before marking it ready:

- `pnpm test tests/main/services/mhtmlDecoder.test.ts`, `pnpm test tests/main/services/captureLinks.test.ts` (PR A).
- `pnpm test tests/main/services/mhtmlParts.test.ts`, `pnpm test tests/main/ipcHandlers.test.ts` (PR B).
- `pnpm test tests/renderer/mhtmlPartsModel.test.ts`, `pnpm test tests/components/MhtmlPartsTab.test.tsx`, `pnpm test tests/components/DataExplorer.test.tsx`, and `pnpm test:e2e` (PR C).
- `pnpm test:reliability` on PR A and PR B, with a clean tree.
- `pnpm typecheck` and `pnpm lint:boundaries`.
- `.claude/hooks/vale-prose.sh --base origin/main` for the assessment row (PR B) and `features.mdx` (PR C).
- Re-derive every known-answer hash with `tail`, `head`, and `sha256sum` and compare it with the test constants.
- `pnpm preflight` at head, with exit codes and output in the PR body (ADR-0017).
