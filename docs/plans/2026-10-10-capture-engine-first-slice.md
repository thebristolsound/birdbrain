# Capture engine, first slice: Transaction Record, inventory, Bound TLS Details, and PDF

**Status:** active

Plan only. Nothing here is built. It plans
[the capture engine first-slice spec](../specs/2026-09-30-capture-engine-design.md) under
[ADR-0034](../adr/0034-the-app-acquires-and-the-extension-is-a-companion.md),
[ADR-0035](../adr/0035-one-transaction-record-per-capture.md) and
[ADR-0036](../adr/0036-credential-header-values-never-enter-a-transaction-record.md), and fulfils
brief CE-P of [the agent briefs plan](2026-10-10-three-programme-agent-briefs.md).

The plan awaits approval. On 2026-10-10 the maintainer ruled on its open questions, the spec's
open questions 1 and 2, and most of its gates (Rulings, 2026-10-10), and deferred approving
the spec and this plan until reading #1803. Until then, every step and decision those rulings do
not settle is a proposal.

It reflects `origin/main` at `df531d36`: `MANIFEST_SCHEMA_VERSION` 5 (`src/shared/constants.ts`),
`CASE_ARCHIVE_SCHEMA_VERSION` 8 (`src/main/services/caseArchive.ts`), `LATEST_SCHEMA_VERSION` 37
(`src/main/services/db/core.ts`), and Electron 44.5.1 (`pnpm-lock.yaml`). Citations name a symbol,
a section, or an issue, as `docs/README.md` asks of an active document, and every one is a reading
of that commit.

Three mistakes in this slice cannot be taken back. Nothing can recall a verifier once it has
shipped, and nothing can amend a Manifest Entry once it is written (ADR-0023, Consequences). A
credential value written into a Transaction Record leaves with every Evidence Package and Case
Archive that carries it (ADR-0036, Context). The order below settles each decision that fixes one
of these before the step that ships it.

## Goal

The slice adds four things to a `background` Capture and changes nothing in the extension (spec,
Problem):

1. **A Transaction Record**: one WARC (ISO 28500:2017) per Capture beside the MHTML, holding the
   exchanges the browser handed over complete, from the first request to the moment of Capture,
   with the values of four credential headers replaced (ADR-0036).
2. **An inventory in the signed `capture` entry**: which of MHTML, Transaction Record, screenshot,
   and PDF are present and why any is absent, what the Transaction Record lacks or holds in part,
   and whether the screenshot was scaled, truncated, or trimmed. Beside it, the entry records how
   Scroll-to-load ended.
3. **Bound TLS Details** for the main document, beside the TLS Cert Chain and never inside it.
4. **A PDF**, printed after everything else.

From the release that carries the writers, Package Verification, `verify.sh`, the Verify Runbook,
Evidence Package export, Case Archive export and import, Duplicate, deletion, and the orphan scan
each check, carry, copy, or remove the two new files.

Out of scope: launched browsers, the Companion, Firefox, the Content Hash of a Capture without
MHTML, and a WACZ export (#799), which the spec leaves out (spec, Not in this slice); WebSocket
frames; the `launched`, `launched-passive`, and `companion` values (D13); display of the new
fields in the app, which #1816 carries after CE-8; Working Copy exports (D10); and the extension
half of #1667, which closes in favor of CE-S3.

## What exists today

Paths are under `src/main/services/` unless named in full.

- **The render.** `renderPageInHiddenWindow` in `backgroundRenderer.ts` attaches `wc.debugger` for
  the whole render and enables no CDP event domain. It loads the page, waits for network idle,
  runs Scroll-to-load, waits again, settles, takes the screenshot, saves MHTML with `wc.savePage`
  and reads `document.body.innerText`. Each render gets a fresh in-memory partition
  (`recapture-<uuid>`, no `persist:` prefix). A Recapture times out at 120 s (`DEFAULT_TIMEOUT_MS`
  in `recapture.ts`), and the renderer reserves 20 s of that for the screenshot, MHTML, and text
  (`FINAL_ARTIFACT_RESERVE_MS`).
- **Why no event domain.** The comment above `createNetworkIdleTracker`, added in #180, says that
  enabling a CDP event domain from `webContents.debugger` "evicts any other CDP client attached to
  the same target", which broke Playwright's own session in e2e. The idle tracker reads the
  session's `webRequest` API instead, and skips WebSocket requests because a live socket would hold
  the render to its limit. The probe ran without Playwright attached.
- **Scroll-to-load reports nothing.** `scrollToLoadLazyContent` returns `void`. It returns at once
  when its budget is zero, and its loop ends four ways: nothing scrollable (the step script returns
  `null`), the height cap (`MAX_SCROLL_CONTENT_HEIGHT_PX`), three steps without growth or progress
  (`SCROLL_STALL_THRESHOLD`), or the phase deadline. Its `try` has a `finally` and no `catch`, so a
  scroll step that throws fails the render, which `CONTEXT.md` (Scroll-to-load) records as failing
  closed. While it scrolls, it lifts a consent wall's `overflow: hidden` (`SCROLL_UNLOCK_SCRIPT`)
  and restores it before the artifacts are taken (`scrollResetScript`).
- **The screenshot.** `captureFullPageScreenshot` scales the image down so its width fits 16,384
  pixels (`MAX_CAPTURE_DIMENSION_PX`), caps the captured height by the same figure and by 32
  megapixels (`MAX_CAPTURE_PIXELS`), and passes the PNG to `trimTrailingBackground`, which crops
  trailing background rows and returns the original image on any error. Nothing records any of the
  three.
- **What reaches ingest.** `RenderedPage` in `recapture.ts` carries the MHTML stream, screenshot,
  text, title, final URL, HTTP status, user agent, browser version, and Consent Suppression. The
  Recapture service ingests it with `method: 'background'`.
- **The signed entry.** `ManifestCaptureEntrySchema` in `src/shared/schemas.ts` is `.strict()`.
  Each newer field is optional and omitted when absent, and `fieldMinReaderSchemaVersion` in
  `manifest.ts` stamps an entry that carries one with the lowest reader version that knows it. PR
  #1747 applied that rule to the schema-5 Egress fields: a refine requires `schemaVersion` 5 when one
  is present, so a schema-4 reader reports "verifier too old" instead of a broken chain
  (`detectUnsupportedEntry` in `src/shared/verify/manifestChain.ts`). Further refines reject shapes
  that contradict themselves, such as `tlsSkipped` beside `tls`. Callers pass fields through
  `CaptureEntryContext` and `withCaptureEntry` in `manifest.ts`.
- **Canonical JSON assumes integers.** The header comment of `src/shared/verify/canonicalJson.ts`
  says `canonicalStringify` and the Verify Runbook's `jq -cS` recipe produce the same bytes because
  entry keys are ASCII and values are integers, and that a non-integer field "would break these
  invariants".
- **Files by name.** The Capture Store names a Capture's files `{caseId}/{captureId}.{type}`
  (`artifactPaths` in `captureStore.ts`). One list, `CAPTURE_ARTIFACT_TYPES` (`mhtml`, `html`,
  `png`, `txt`), drives Duplicate's copy, deletion, the staged delete and its restore, and Case
  Archive export, which names each file `files/{captureId}.{type}` (`exportCaseArchive`). The
  Case Archive import loop splits a name at its last dot and writes `mapId(oldId) + ext`.
  `parseArtifactFilename` matches `^(.+)\.(html|png|txt|mhtml|jpg)$`, so it returns null for
  `{id}.warc.gz` and `{id}.pdf`, and `findOrphans` skips a name it cannot parse: today the
  orphan scan ignores both names.
- **The orphan scan deletes what it reports.** `findOrphans` in `db/dbAdmin.ts` reports a flat file
  whose parsed id has no Capture, and a Capture row whose `html_path`, `screenshot_path`, or
  `mhtml_path` file is missing. `cleanOrphans` deletes every reported file, and every reported
  Capture row with its Exhibit row.
- **Path columns drift on import.** The `version < 37` block in `db/migrations.ts` rewrote the path
  columns of imported Captures, which had kept the source Case's paths (#1592). The `.txt` file has
  a `text_hash` column and no path column.
- **Sidecar checks.** `verifySidecars` in `captureLifecycle.ts` binds the screenshot and text to
  the hashes in the signed entry, never the row, and reports a changed file as `tampered` and an
  absent one as `missing` (#1661). Duplicate re-checks each copied file against the source entry's
  hash, and re-anchors only the hashes and facts that entry records, `tls` included.
- **Evidence Packages.** `screenshotPath` in `src/packages/evidence-package-layout/lib/paths.ts`
  places a screenshot at `screenshots/{sha256}.png`, and `export.ts` emits each content address
  once. `verifyEvidencePackage` in `src/shared/verify/evidencePackage.ts`, which the standalone
  verifier (`src/verifier/cli.ts`) also runs, skips an absent `screenshotHash` and fails a present
  one whose file is missing or different. `verify.sh` does the same in step 5, "content bind to the
  signed chain" (`verifyScript.ts`, `verifyProcedure.ts`), through shell helpers rendered from the
  TypeScript path functions (`lib/shell.ts`). The `evidence.json` schema accepts keys the verifier
  does not read (the comment above `EvidenceArtifactSchema`).
- **Containers.** `createStoredZip` in `zip.ts` writes every Evidence Package and Case Archive entry
  uncompressed, builds the whole archive in memory with `Buffer.concat`, and writes sizes and
  offsets as 32-bit fields with no ZIP64 code, so one archive stays under 4 GiB. The Case Archive
  importer reads stored entries only (`zipRead.ts`).
- **Capture Methods.** `CAPTURE_METHODS` in `src/shared/types.ts` holds `extension`, `background`,
  and `duplicate`. The `captures.method` column has no CHECK constraint.
- **Tiers.** `src/packages/evidence-package-layout/**` is on neither list of
  [the evidence-affecting paths assessment](../specs/2026-07-31-evidence-affecting-paths-assessment.md),
  although Package Verification and `verify.sh` read every package path from it. `manifest.ts`,
  `src/shared/verify/**`, `src/verifier/**`, `backgroundRenderer.ts`, `recapture.ts`,
  `captureLifecycle.ts`, `captureStore.ts`, `caseArchive.ts`, `export.ts`, `reportHtml.ts`,
  `verifyScript.ts`, `verifyRunbook.ts`, and `db/**` are blocking; `src/shared/schemas.ts`,
  `types.ts`, `constants.ts`, and `package.json` are advisory.
- **Tests.** Unit tests run Vitest under `ELECTRON_RUN_AS_NODE=1` (the `test` script in
  `package.json`) and mock Electron (`tests/main/services/backgroundRenderer.test.ts`), so no unit
  test renders a page. CI runs the e2e suite against the built app under `xvfb-run`
  (`.github/workflows/ci.yml`, `e2e` job, step `Run E2E tests`). `e2e/recapture.spec.ts` serves its
  fixture from `127.0.0.1`, and `e2e/recapture-consent.spec.ts` feeds a local filter list through
  `BIRDBRAIN_CONSENT_LISTS`.
- **Dependencies.** No WARC or PDF library is installed (`package.json`).
  `scripts/third-party-notices/notices.mjs` runs before every packaging script and in CI's build
  job, and fails on a production package with no licence text. An `append` entry in `overrides.json`
  adds texts to the ones a package carries, as the `@img/sharp-win32-arm64` entry does for a
  declared licence its file lacks; `scripts/third-party-notices/texts/` holds no Apache-2.0 text.
  Dependabot opens one grouped weekly pull request for npm minor and patch updates, with no
  exception for Electron (`.github/dependabot.yml`, `npm` group).

## Probe rerun on Electron 44.5.1

The spec's risk section asks for the probe to be rerun on each Electron upgrade. The probe ran on
44.4.5, and `package.json` now asks for `^44.5.1`. A separate agent reran it on 2026-10-10 at
`df531d36`.

**No measured value changed.** The installed build is Electron 44.5.1 on Chromium 152.0.7977.130
with Node 24.21.0 (`process.versions`, read for this plan). Chromium is the same build the 44.4.5
run used, so the rerun exercised changes inside Electron only. All three configurations ran under
`xvfb-run`, and every measurement in
[the probe spike](../specs/2026-10-02-capture-engine-probe-spike.md) matched.

| Measure | 44.4.5 (probe spike) | 44.5.1 (rerun) |
| --- | --- | --- |
| `navigator.webdriver`, `window.chrome` keys, `Error.stack` getter reads; off and on passes | `false`, none, 0 in both | same |
| `document.hasFocus()`, `document.visibilityState` | equal in both passes; values not recorded | `false` and `visible` in both passes |
| Resource timing list | equal in both passes | `/gz.txt`, `/img.png`, `/plain.txt`, `/redir` in both |
| Bodies returned before the PDF, digest matching the served payload | 5 of 5 | 5 of 5 |
| `gzip` body | 70 bytes on the wire, 4,200 decoded, `Content-Encoding: gzip` kept | same |
| Image used twice | one server hit, one exchange, no `requestServedFromCache` | same |
| Redirect | 7 exchanges for 6 request ids; no body on the `302` | same |
| `responseReceivedExtraInfo` with `headersText` | 7 of 7 | 7 of 7 |
| `webContents.printToPDF` in the offscreen window | 7,224 bytes; one Letter page holding `probe` and two images | same, both passes |
| `Page.printToPDF` over `webContents.debugger` | `'Page.printToPDF' wasn't found` | same |
| Print seen by the page | `beforeprint`, `afterprint`, print media query changed; print-only image fetched | `beforeprint`, `mq:false`, `mq:true`, `afterprint`, `mq:false`; print-only image fetched |
| Blank page, then `Network.enable`, then the target | enable answered before the first request | same; first exchange `/` |
| `Network.enable` on a window that has not navigated | no reply in 4 of 4 runs | no reply in 4 of 4 (94 to 96 s each, ended by the 90 s timeout); no page process lost |
| `loadingFailed` events, on pass | not reported | 0 |

**What it means for this plan.** Three measured facts hold on the pinned Electron: enabling
`Network` changes none of the page facts the probe compared, `Network.enable` still needs a page
loaded first (step 9 loads `about:blank`), and `webContents.printToPDF` still works in the
offscreen window (step 10). The compared facts leave out `history.length`, and the `about:blank`
load changes it. A scratch script run for this plan on Electron 44.5.1 under `xvfb-run`, in an
offscreen sandboxed window with a fresh partition and the debugger attached, read
`history.length` 1 when the target loaded directly and 2 when `about:blank` loaded first, with
`wc.navigationHistory.length()` also 2. The probe's off pass loads the target directly and its on
pass loads `about:blank` first, and neither records `history.length`. Step 0 question 7 takes it
up. The rerun covers no Chromium change, so the next Chromium bump is where D15's check matters.
Its limits are the probe's own (probe spike, What this does not show): plain HTTP from one origin,
no Playwright, no consent filter, and one run per pass.

**How it ran.** The probe has no standalone file. The script is the one under "The probe" in the
probe spike at `df531d36`, extracted unchanged into a scratch worktree whose dependencies came from
`scripts/setup-worktree.sh` on Node 20.20.2. The off and on passes exited 0. The four
fresh-window runs exited 1 through the script's `FATAL` handler: the 90 s timer began shutdown,
which rejected the pending `Network.enable` with `target closed while handling command` (each
run's log). The timer's own exit code is 2. Nothing was committed. The branch
`drafts/2026-10-02-capture-engine-probe-spike` holds the older 44.3.0 script, which writes to a
fixed directory, tracks no redirect hops, and records no enable error; the rerun did not use it.

````shell
mkdir ce-probe
awk '/^## The probe/{f=1} f&&/^```js/{g=1;next} g&&/^```/{exit} g{print}' \
  docs/specs/2026-10-02-capture-engine-probe-spike.md > ce-probe/main.js
cd ce-probe
env -u ELECTRON_RUN_AS_NODE PROBE_PASS=off xvfb-run --auto-servernum ../node_modules/.bin/electron --no-sandbox main.js
env -u ELECTRON_RUN_AS_NODE PROBE_BLANK_FIRST=1 PROBE_PASS=on xvfb-run --auto-servernum ../node_modules/.bin/electron --no-sandbox main.js
for i in 1 2 3 4; do env -u ELECTRON_RUN_AS_NODE PROBE_OUT=out/fresh$i PROBE_PASS=on xvfb-run --auto-servernum ../node_modules/.bin/electron --no-sandbox main.js; done
````

## Decisions

The maintainer accepted D1 to D7 as the shape step 1 freezes (open question D) and ruled D15's
rerun policy (the CI test, the script in step 9, the maintainer's CI-job pull request). Every other
decision, and any part of D8, D14, or D15 that no ruling names, is this plan's recommendation until
the maintainer approves the plan. D17 and the two counts it adds to D4 await the maintainer's
approval on their own pull request (Ruling, 2026-10-17).

### D1. Six optional fields on the `capture` entry

| Field | Shape | First written by |
| --- | --- | --- |
| `inventory` | object (D4) | step 6 |
| `scrollToLoad` | object (D5) | step 6 |
| `transactionRecordHash` | SHA-256 hex of the stored Transaction Record | step 9 |
| `boundTls` | object (D7) | step 9 |
| `boundTlsAbsent` | `not-recorded`, `not-https`, `from-cache`, or `not-reported` | step 9 |
| `pdfHash` | SHA-256 hex of the stored PDF | step 10 |

`transactionRecordHash` uses the glossary term, because `CONTEXT.md` lists "WARC file" as a name to
avoid for it. `boundTls` sits beside `tls`, never inside it (spec, Bound TLS Details), so the entry
says which of the two TLS facts it holds (ADR-0034, What this amends). In this slice only
background Captures write the fields; extension Captures write none, and a Duplicate re-anchors its
source's except Bound TLS Details (D11). The maintainer accepted these names and shapes on
2026-10-10 (open question D).

**`boundTlsAbsent` departs from the spec.** The spec says that when the main document came from
the cache, Bound TLS Details are absent "and the inventory says why" (spec, Bound TLS Details),
and the agent briefs plan puts that reason in the Transaction Record part of the inventory
(CE-7). This plan puts the reason beside `boundTls` instead. A Duplicate re-anchors its source's
inventory and writes no Bound TLS Details (D11), so an inventory part saying Bound TLS Details are
present, copied to a Duplicate, would contradict the Duplicate's own entry. The alternative is an
inventory part, `boundTls: { present: true } | { present: false; reason }`, which a Duplicate
rewrites instead of copying. The maintainer ruled for the top-level `boundTlsAbsent` (open
question D).

### D2. One schema number, integers only, and refines only where a shape contradicts itself

- Step 1 takes the next manifest schema number, N, settled when it starts against the releases that
  have shipped (the agent briefs plan, manifest schema lane). If another schema step holds a number
  no release has shipped, step 1 joins it. The maintainer ruled on 2026-10-10 that beta.23 (#1799)
  ships as is, carrying only the schema-5 (Egress) reader, so the ADR-0040 and #586 schema steps
  share the later release with step 1's verifier. Each D1 field stamps N through
  `fieldMinReaderSchemaVersion`, and a refine refuses one stamped below N, as for the Egress fields.
- Each part of a new field admits only the values this slice can write. #599 states the rule for a
  Capture Method, "A value nothing can produce is its own false statement", and this plan applies
  it to every new field. A later stage that needs another value takes a schema step.
- A released verifier cannot be recalled, so step 1 adds a refine only where the opposite shape
  contradicts itself, the test #1747 applied:
  1. `transactionRecordHash` requires `inventory`, and is present exactly when
     `inventory.transactionRecord.present` is true.
  2. The same rule for `pdfHash` and `inventory.pdf`.
  3. When `inventory` is present, `screenshotHash` is present.
  4. `boundTls` and `boundTlsAbsent` are never both present, the rule `tls` and `tlsSkipped` follow.
- No refine ties a field to a Capture Method, so stage 2 can reuse the fields without loosening a
  released rule.
- Every number in the new fields is a non-negative integer (`.int().nonnegative()`) and every time
  is an ISO 8601 string, so the canonical JSON invariants hold. Step 1 tests that one entry carrying
  every field hashes the same through `canonicalStringify` and through the Verify Runbook's `jq -cS`
  recipe.
- Step 1 adds the fields to `CaptureEntryContext` and `withCaptureEntry` as pass-through values,
  omitted when undefined, so no writer step touches `manifest.ts`.
- Step 1 creates the shared list of the hash fields a `capture` entry anchors (`contentHash`,
  `screenshotHash`, `textHash`, `transactionRecordHash`, `pdfHash`), or extends it if SC-2 (#1512)
  created it first (D14). The list is an exported constant, `CAPTURE_ENTRY_HASH_FIELDS` (a
  proposed name), in `src/shared/verify/manifestChain.ts` beside `CaptureChainEntry`, and SC-2's
  brief uses the same name and module (What this changes in the agent briefs plan).

### D3. File names and the Package Layout

- In the Case directory: `{captureId}.warc.gz` and `{captureId}.pdf`, flat beside the MHTML like
  every other Capture file.
- In an Evidence Package: content-addressed like the screenshot, at
  `transaction-records/{sha256}.warc.gz` and `pdfs/{sha256}.pdf`, so Package Verification checks
  them as it checks `screenshotHash` (spec, Manifest, schema, and verifier). A Duplicate's copied
  files hold its source's bytes, so one zip entry serves both.
- Step 1 adds `transactionRecordPath(digest)` and `pdfPath(digest)` to `lib/paths.ts` and their
  shell helpers to `lib/shell.ts`, so the writer, Package Verification, and `verify.sh` read one
  definition (`CONTEXT.md`, Package Layout).
- The extension is `.warc.gz`, ruled on 2026-10-10 (spec open question 2, below). It had to be
  settled before step 1, because the path function fixes it in a released verifier.

### D4. The inventory

```ts
inventory: {
  mhtml: { present: true; pinnedImages: number; pinnedImagesNotLoaded: number }
  transactionRecord:
    | Absent
    | {
        present: true
        exchanges: number
        cached: number
        cancelled: number
        failed: number
        inFlight: number
        finishedWithoutResponse: number
        bodiesOmitted: number
        incompleteRequestBodies: number
        webSockets: number
        recordedTargets: number
        unrecordedTargets: number
        replacedHeaders: string[]
        budget: { totalBytes: number; resourceBytes: number }
      }
  screenshot: {
    present: true
    scaled: boolean
    truncated: boolean
    trimmed: boolean
    contentWidth: number
    contentHeight: number
    width: number
    height: number
  }
  pdf: Absent | { present: true; afterCollection: true }
}
// Absent = { present: false; reason: 'not-taken' | 'failed' }
```

- **MHTML and the screenshot are always present.** A failed `savePage` or screenshot fails the
  render today, and this slice keeps that, so no build can write either as absent (D2's rule).
- **The MHTML counts.** `pinnedImages` is the number of images the render pinned to their
  displayed source before the save, and `pinnedImagesNotLoaded` the number of those not loaded
  when the save ran (#1843, amended 2026-10-21). The schema requires both whenever `inventory` is
  present. A fifth refine joins D2's four: `pinnedImagesNotLoaded` above `pinnedImages` fails the schema.
  #1843 writes the counts; step 1 only teaches the verifier them.
- **Reasons.** `not-taken` means this build does not take the file: step 6's build writes it for
  the Transaction Record and the PDF. `failed` means the engine tried and failed, or refused a PDF
  over step 10's size bounds, and the log carries the error. The list is closed, so a released
  verifier never meets a reason it does not know.
- **The Transaction Record counts.** Each comes from one CDP event or check.
  - `exchanges`: request and response record pairs written. Each `Network.requestWillBeSent` starts
    one, so every redirect hop counts (probe spike, "A redirect is two exchanges under one request
    id").
  - `cached`: `Network.requestServedFromCache` events, and responses that report `fromDiskCache`.
    Neither is written as a complete exchange. A resource used twice inside one page leaves no event
    at all (probe spike, "A resource used twice produced one exchange and no cache event"), so no
    count includes that case, and the docs say so beside the capability.
  - `cancelled` and `failed`: `Network.loadingFailed` with `canceled` true and false. Step 0 checks
    how the consent filter's cancels arrive.
  - `inFlight`: neither `loadingFinished` nor `loadingFailed` had arrived when collection stopped.
  - `finishedWithoutResponse`: a request the browser reported finished (`loadingFinished`) for
    which no response arrived (`responseReceived`). It is counted in neither `inFlight` nor
    `exchanges`, so the signed entry tells "still loading at the moment of Capture" from
    "finished, but the browser gave no response". Step 9's review (#1999) saw one, a service
    worker's own main script. Added 2026-10-26 on the maintainer's ruling during that review,
    as the orchestrating session relayed it: step 9 had counted these in `inFlight`, and the
    count joins schema 6 before any release carries it.
  - `bodiesOmitted`: a finished response whose body `Network.getResponseBody` did not return,
    because it was over the budget or the browser no longer held it. One count covers both, because
    the probe tested neither case and nothing yet shows the two failures can be told apart. With
    D17 it also counts a body the engine did not fetch because fetching it could have taken the
    total past the body cap (D17, "The attach", item 7).
  - `incompleteRequestBodies`: a request that reports `hasPostData` and whose body is still
    incomplete after `Network.getRequestPostData` (spec, Transaction Record).
  - `webSockets`: `Network.webSocketCreated` events. ADR-0035 has the inventory account for every
    exchange the record lacks, and a WebSocket handshake reaches CDP outside `requestWillBeSent`.
    Frames are not recorded (spec open question 5).
  - `recordedTargets` and `unrecordedTargets`: the targets whose setup answered and those whose
    setup failed, did not answer, or was not attempted, each target in exactly one, as D17 defines
    them ("The two counts"). Proposed 2026-10-17, with D17, for the maintainer's approval: they
    change the D4 shape accepted on 2026-10-10.
  - `replacedHeaders`: the lower-case names whose values the writer replaced (ADR-0036), sorted and
    unique.
  - `budget`: the two limits passed to `Network.enable`, so a reader knows what "over the budget"
    meant, and step 9 can change the values without a schema step.
- **The PDF part.** `afterCollection` states that the PDF was printed after collection stopped,
  which the spec asks the inventory to say (spec, PDF). This slice can write only `true`.

### D5. Scroll-to-load

`scrollToLoad: { requested: true, ran: boolean, outcome?, endHeight?, scrollLockLifted: boolean }`.

The background renderer always requests the phase. `endHeight` is the last document height the
step script reported, in CSS pixels, and is absent when the loop read none. `scrollLockLifted` is
true when `SCROLL_UNLOCK_SCRIPT` lifted a consent wall's lock: the lock is restored before the
artifacts, but loosening it can change which lazy content loads. `outcome` maps to where
`scrollToLoadLazyContent` ends today:

| Record | Where the loop ends |
| --- | --- |
| `ran: false`, no outcome | budget zero at the start |
| `nothing-to-scroll` | the step script found no scrollable root |
| `height-cap` | the page reached `MAX_SCROLL_CONTENT_HEIGHT_PX` |
| `stopped-growing` | `SCROLL_STALL_THRESHOLD` steps without growth or progress |
| `time-budget` | the phase deadline |

The spec also names a failure outcome (spec, Artifact inventory and Scroll-to-load). The background
renderer fails the Capture when a scroll step throws, which already meets "a Scroll-to-load that
fails never silently yields a static Capture" (`CONTEXT.md`, Scroll-to-load), so no build in this
slice can write `failed`. By D2's rule the value arrives with the first engine that records a
failed phase and keeps the Capture, as #1667 describes for the extension.

### D6. The screenshot record

`contentWidth` and `contentHeight` are the content box the screenshot was asked for, in CSS pixels
(`width` and `fullHeight` in `captureFullPageScreenshot`). `scaled` is a scale below 1. `truncated`
is a captured height below the content height. `trimmed` is a crop by `trimTrailingBackground`.
`width` and `height` are the stored PNG's pixel dimensions. A trim that fails returns the original
image and records `trimmed: false`. Both functions return these facts beside the image.

### D7. Bound TLS Details

`boundTls` records the main document response's `securityDetails`. The spec asks for "the
structured fields the TLS spike lists" and names eight in a parenthetical: protocol, key exchange,
cipher, subject, subject alternative names, issuer, validity, and the signed certificate
timestamps (spec, Bound TLS Details). The TLS spike's list has four more: `certificateId`,
`certificateTransparencyCompliance`, `serverSignatureAlgorithm`, and `encryptedClientHello`
([the TLS spike](../specs/2026-05-17-chrome-debugger-tls-spike.md), section 2.1). This plan keeps
the spike's list except `certificateId`, and adds `mac`:

| Field | Kept | Why |
| --- | --- | --- |
| `protocol`, `cipher`, `subjectName`, `sanList`, `issuer`, `validFrom`, `validTo` | yes | The spec's parenthetical names each. |
| `signedCertificateTimestampList`, each with `status`, `origin`, `logDescription`, `logId`, `timestamp`, `hashAlgorithm`, `signatureAlgorithm`, and `signatureData` | yes | The spec's parenthetical names the timestamps. |
| `keyExchange`, `keyExchangeGroup` (optional) | yes | CDP splits the key exchange the spec names across both: `keyExchange` is "the empty string if not applicable", and `keyExchangeGroup` is the "(EC)DH group used by the connection, if applicable". |
| `mac` (optional) | yes | Neither list names it. CDP splits the cipher the spec names across `cipher` and `mac`, and reports `mac` only for a cipher that has one ("AEAD ciphers do not have separate MACs"). |
| `certificateTransparencyCompliance` | yes | The TLS spike names CT compliance as the field that shows whether the certificate was CT-logged (section 2.1). CDP describes it as whether the request complied with Certificate Transparency policy, and its three values (`unknown`, `not-compliant`, `compliant`) are a closed set the schema can admit exactly. |
| `serverSignatureAlgorithm` (optional) | yes | The spike lists it. It is an integer TLS SignatureScheme code point, so it keeps the canonical JSON invariants. |
| `encryptedClientHello` | yes | The spike lists it. It is a boolean. |
| `certificateId` | no | A handle into the render's own session, which means nothing once the render ends. |

- `keyExchange` may be `''`, and the schema admits the empty string for it. The newer capture
  fields `egressLabel` and `userAgent` use `.min(1)` and are never `''`
  (`ManifestCaptureEntrySchema`); a verifier that copied that rule would reject every `boundTls`
  whose connection reports no separate key exchange, and no released verifier can be recalled.
  Step 0 question 6 records the value Chromium 152 reports.
- CDP gives `validFrom` and `validTo` as seconds since the epoch and an SCT `timestamp` as
  milliseconds, all as plain numbers. Step 7 converts each to an ISO 8601 string, the form the TLS
  Cert Chain's `refetchedAt` uses (`tlsCertChain.ts`), so no fraction enters the entry. The TLS
  Cert Chain stores validity as the text Node's `valid_from` and `valid_to` report, which is not
  ISO 8601, so the two TLS facts will not share a date format.
- Adding a field later costs a schema step (open question D).
- `boundTlsAbsent` is `not-recorded` when the Capture has no Transaction Record, `not-https` for an
  `http:` main document, `from-cache` when the main document's response reports a cache hit (spec,
  Bound TLS Details), and `not-reported` when the response carried no `securityDetails` for any
  other reason. A fresh partition makes `from-cache` rare; the spec still asks for the reason. The
  field sits beside `boundTls`, outside the inventory, which departs from the spec (D1).
- The field is the browser's summary and holds no certificate bytes, so it supports no independent
  signature check (spec, Bound TLS Details). The report and `features.mdx` say so beside it.

The field names and types come from the `devtools-protocol` npm package 0.0.1716261
(`json/browser_protocol.json`, read 2026-10-10), which tracks the tip of tree. Step 0 checks them
against a Chromium 152 response.

### D8. Writing the Transaction Record

- **Records.** One `warcinfo` record naming Birdbrain's version, the browser version, the user agent,
  and the capture id (spec, Transaction Record), plus fixed statements of the header renaming
  (spec open question 1) and the credential marker, so the file describes itself to a reader that
  has only the WARC. It holds no host name, address, or proxy. One `request` and one `response`
  record per complete exchange, and the records in the table below for every other exchange.
- **Compression.** Each record is its own gzip member (spec open question 2, ruled 2026-10-10).
  `warcio`'s serializer takes a `gzip` option and serializes one record at a time
  (`WARCSerializer` in `src/lib/warcserializer.ts` of the 2.4.12 tarball).
- **Digests.** `WARC-Payload-Digest` is `sha256:` followed by hex, over the stored, decoded body.
  That is `warcio`'s default (`sha-256`, prefix `sha256:`, base32 off, same file), so a test can
  compare it with Node's `createHash('sha256')`.
- **Header blocks.** The writer builds each header block from the structured headers CDP reports,
  preferring the `ExtraInfo` events', and never serializes `headersText` or `requestHeadersText`.
  ADR-0036 requires the replacement before any byte reaches disk, and one structured path covers
  HTTP/1.1, HTTP/2, and HTTP/3 alike; `headersText` is absent for the last two (spec, What the record
  is and is not). Header names that start with `:` (HTTP/2 pseudo-headers) are left out, as
  browsertrix-crawler does (`src/util/reqresp.ts` at `b8c38c4d`, `_getHeadersDict`).
- **Credential headers.** The values of `Cookie`, `Set-Cookie`, `Authorization`, and
  `Proxy-Authorization` become one fixed ASCII marker held in a single constant (ADR-0036,
  Decision). The replacement runs in memory on every header map the writer reads: `headers` and
  `requestHeaders` on the request and response, and the headers of both `ExtraInfo` events. The
  `associatedCookies`, `blockedCookies`, and `exemptedCookies` arrays carry cookie values and are
  never serialized. Step 8 names the marker, and the docs quote it.
- **Decoded bodies under original headers.** The writer keeps the reported `Content-Encoding`,
  `Transfer-Encoding`, and `Content-Length` under `x-orig-` names and writes the stored body's
  length as `Content-Length` (spec open question 1, ruled 2026-10-10).
- **Addresses.** The writer sets `WARC-IP-Address` only while the Egress is Direct. Through a proxy,
  CDP's `remoteIPAddress` and `remotePort` can name the proxy, and ADR-0032 rule 5 keeps the proxy's
  host and port out of every record (the agent briefs plan, CE-7).

**Partial exchanges.** The spec has the inventory, not the WARC, account for every exchange that
is not complete (spec, Transaction Record), and ADR-0035 never lets the record read as more
complete than the inventory supports. Apart from a redirect, which has no body of its own, a
`response` record with no body would read as a complete empty response, so each partial exchange
gets the records below. WARC 1.1 defines `WARC-Truncated` for a record whose content block was cut
short, with the reasons `length`, `time`, `disconnect`, and `unspecified`. `warcio`'s
`WARCRecord.create` takes arbitrary `warcHeaders` (`src/lib/warcrecord.ts` in the 2.4.12
tarball).

| Exchange (D4 count) | Records written |
| --- | --- |
| Complete | `request`, and `response` with the body |
| Redirect hop | `request`, and `response` with headers and no body, as the spec says: the browser keeps no body for one |
| Body omitted (`bodiesOmitted`) | `request`, and `response` with headers, no body, and `WARC-Truncated: unspecified`, because one count covers an over-budget body and one the browser no longer held (D4) |
| Request body incomplete (`incompleteRequestBodies`) | `request` holding what `Network.getRequestPostData` returned, with `WARC-Truncated: unspecified`; its response follows the other rows |
| Failed, cancelled, in flight, or finished with no response (`failed`, `cancelled`, `inFlight`, `finishedWithoutResponse`) | `request` only |
| Served from the cache (`cached`) | `request` only |

### D9. The `captures` row

Step 2 adds six nullable TEXT columns that mirror D1: two hashes (`transaction_record_hash` and
`pdf_hash`) and four columns holding JSON or the enum value (`inventory`, `scroll_to_load`,
`bound_tls`, and `bound_tls_absent`), as `tls_cert_chain` holds the TLS Cert Chain. It adds no
path columns: the Capture Store derives every path from the Capture id and the type, the `.txt`
file already works that way, and path columns are what drifted on import (#1592). The mirror is
a cache for queries and in-app display. Every check, and the report (step 5), reads the signed
entry (the comment above `CaptureChainEntry` in `manifestChain.ts`), because Settings -> Database
can hand-edit the row (the Duplicate path's comment in `captureLifecycle.ts`).

### D10. Both files always ship

An Evidence Package export offers no option to leave out the Transaction Record or the PDF,
because Package Verification fails a present hash whose file is missing, the rule step 1 copies
from `screenshotHash` (spec, Manifest, schema, and verifier). Today the screenshot follows the
export's `include.screenshots` option (`export.ts`); how that option meets the screenshot check was
not checked for this plan. A Working Copy stays as it is: "the selected Exhibits, their
screenshots, and Notes" (`CONTEXT.md`, Working Copy).

### D11. Duplicate

A Duplicate copies both files and re-checks each against the source entry's hash, refusing the
copy when either differs. It re-anchors `transactionRecordHash`, `pdfHash`, `inventory`, and
`scrollToLoad` from the source's signed entry, as it does the screenshot and `tls`, because they
describe the copied files. It writes no `boundTls` and no `boundTlsAbsent`: `CONTEXT.md` (Bound TLS
Details) has them absent for `duplicate` Captures, and the method already says why. The `warcinfo`
record in the copied file names the source's capture id, which is accurate: the bytes are the
source's.

### D12. Where the code lives

The collector, the Bound TLS conversion, and the writer form one package,
`src/packages/transaction-record/`, with the entry points `collector.ts` and `boundTls.ts` (step 7)
and `writer.ts` (step 8), per `src/packages/README.md` ("Entry points, not barrels"). The package
imports nothing from Electron: CDP events and responses come in as plain data, so its tests run in
the existing unit runner. The wiring stays in `backgroundRenderer.ts`. Step 7 adds
`src/packages/transaction-record/**` to the assessment's blocking tier, under Acquisition.

### D13. `launched` stays out of step 1

ADR-0034 names `launched`, and carrying it in step 1 would save stage 2 one verifier release if
stage 2 added no field of its own. This plan leaves it out:

- Stage 2 adds fields.
  [The stage 2 spec](../specs/2026-10-10-capture-engine-launched-browser-design.md) (CE-S2), on an
  unmerged branch, gives a `launched` entry the browser product, version, and family (its section
  "Manifest, schema, and verifier"), and the maintainer ruled on 2026-10-10 to sign them (CE-S2
  decision D12). The shape step 1 freezes holds none of them, so stage 2 needs its own verifier
  release anyway. The same section asks whether CE-5 carries the inventory reasons stage 2 adds
  (served by a service worker, restored from the back-forward cache, request body withheld, and
  others). The D4 reason list the maintainer accepted is closed at `not-taken` and `failed`, so
  stage 2's inventory reasons also ride stage 2's verifier step.
- A verifier that accepts `launched` now accepts it in the shape of a `background` entry, and
  Package Verification compares the method with `evidence.json`'s origin. `CAPTURE_METHODS` also
  feeds the app's types, so the value would reach every surface that labels a method before
  anything writes it.
- `launched-passive` stays out too. The maintainer ruled on 2026-10-10 that the verifier learns it
  in a release before #600's writer merges, that the glossary and reporting surfaces change with
  #600, and that #599's "This lands **with** the restoration (#600), not before" is to be clarified
  (CE-S2 decision D5). A `launched-passive` entry records which rule took it, every page or a
  Selector match (CE-S2 decision D12), a field the shape step 1 freezes does not hold, so the value
  rides stage 2's verifier step. `companion` waits for CE-S3 (ADR-0034, Decision, order of work).

The cost is one more verifier release, and one more upgrade for Shared Case members on mixed
versions, when stage 2 ships.

### D14. Shared Cases

Step 1 creates or extends the shared list of anchored hash fields, `CAPTURE_ENTRY_HASH_FIELDS` in
`src/shared/verify/manifestChain.ts` (D2). SC-2 builds its blob list from that list (the agent
briefs plan, SC-2), so a Shared Case carries and hash-checks both files whichever of the two
merges first. The two-peer `MemoryTransport` test that a receiver hash-checks
the Transaction Record and the PDF before showing them then belongs to whichever of SC-2 and steps 9
and 10 merges second. This replaces the agent briefs plan's rule that CE-7 waits for SC-2 (open
question C, ruled 2026-10-10).

### D15. The probe runs in CI on each Electron change

The gates table offers an Electron-run CI test in CE-7 or a rule that every Electron bump attaches
a rerun. **Ruled 2026-10-10:** the CI test on each Electron change: step 9 commits the probe
script, and the maintainer opens the pull request that adds the CI job (ADR-0048 sign-off).
Dependabot groups npm minor and patch updates into one weekly pull request with no exception for
Electron, so an Electron patch can arrive in a pull request nobody reads as a browser change, and
ADR-0004 names a browser change as a trigger for revalidation (ADR-0004, Validation and
independent verification).

Step 9 commits the probe script as a file (proposed path `scripts/capture-probe/main.js`), with
the command that runs its off and on passes and the output it expects. The passes run without the
90 s fresh-window case, as a standalone Electron script under `xvfb-run`, the probe's own form.
The script fails when `navigator.webdriver`, the `window.chrome` keys, the `Error.stack` getter
count, the resource timing list, or `history.length` differ between the passes; step 0 question 7
decides whether `history.length` must be equal or may differ by the one entry `about:blank` adds.
Running it inside the e2e suite would add Playwright's own CDP session, which could move the
`Error.stack` count the check measures; that effect is unmeasured. The limit: the script
reproduces the window configuration, not the app's code.

**The CI job is the maintainer's pull request.** Running the script on any pull request that
changes the `electron` version in `pnpm-lock.yaml` needs a job in `.github/workflows/ci.yml`. The
machine account's token carries no `workflow` scope, so an agent branch cannot land that edit
(the header comment of `tests/helpers/jq.ts`), and ADR-0048 holds every change under
`.github/workflows/` until the maintainer signs off at head. The job goes in its own small pull
request that the maintainer opens after step 9 merges, which ADR-0048 exempts.

### D16. The validation record

ADR-0004 requires a version-specific validation record for every evidence-affecting release, with
environments, expected and observed results, deviations, false positives and negatives, known
limitations, and the acceptance decision (ADR-0004, Validation and independent verification).
Step 6 starts `docs/specs/2026-10-NN-capture-engine-first-slice-validation-assessment.md`, steps
9 and 10 extend it, and the maintainer records the acceptance decision in it before the release
that ships the writers. `-assessment.md` is one of the suffixes `docs/README.md` lists for
`specs/`, which treats a spec as immutable once approved. The acceptance decision is this record's
approval, so the steps extend it before then and nothing changes it after.

### D17. Out-of-process frames and workers

**Ruled 2026-10-17: the engine attaches to each cross-site frame's process and records its
requests, so the Transaction Record covers the whole page (option (a) of the question on #1823;
the ruling is recorded there in a comment of the same day). This design awaits the maintainer's
approval on its pull request, and step 1 does not start before it.** The renderer spike found that
a cross-site iframe runs in a renderer process of its own and that none of its subresource
requests reach `wc.debugger`; its document request starts there and never finishes there
([renderer spike](../specs/2026-10-11-capture-engine-renderer-spike.md), Question 4). That met
step 0's first stop condition.

**Measured on 2026-10-17.** A standalone scratch Electron script, not the app's renderer: Electron
44.7.0 (Chromium 152.0.7977.130) under `xvfb-run`, an offscreen window on a fresh partition,
`about:blank` loaded and `Network.enable` sent with no buffer limits before the target, and no
Playwright client attached. The target, on `127.0.0.1`, started a dedicated worker and framed a
page on `localhost`; the framed page loaded a stylesheet, an image, a `fetch`, and a dedicated
worker of its own, and each worker fetched one file. The two servers logged ten requests in each
pass.

| Pass | What `wc.debugger` reported |
| --- | --- |
| As today: `Network.enable` on the page only | The page's document and image, finished. The frame's document and the page's worker script started and never finished. Nothing for the frame's stylesheet, image, `fetch`, or worker, or for either worker's file. |
| `Target.setAutoAttach` with `autoAttach`, `waitForDebuggerOnStart`, and `flatten` on the page's session, then on each attached target `Network.enable`, the same `Target.setAutoAttach`, and `Runtime.runIfWaitingForDebugger` | Three targets attached, each paused until resumed: the page's worker (type `worker`), the frame (type `iframe`), and the frame's worker. All ten requests appeared and finished. `Network.getResponseBody` sent on the frame's session returned the frame's bodies. |

Further readings. A frame's document request and a worker's script request start on the parent's
session and finish on the child's, under one request id, and a worker's own fetch sends its
`ExtraInfo` events on the parent's session. The page's own dedicated worker was missing from the
first pass although it shares the page's origin, so the gap is not only cross-site frames. The
pull request's review ran two variants of the same script: a service worker the page registers
attaches to the page's session as type `service_worker`, paused, and when it is resumed without
`Network.enable` its script and its own fetch reach the server and appear on no session; a shared
worker never attaches to the page's session, and of its requests only its script appears there.

**The setup order, measured.** The review then found that the order each attached session is set
up in decides what loads. A second scratch script reran that comparison on 2026-10-17, on the same
Electron and host: the fixture above plus a service worker the page registers, whose install
handler fetches a file. In the first run of each of the first two orders below, no `fetch` read
its body; in every other run each `fetch` read its body. In a pass where everything ran, the two
servers logged twelve requests.

| Order on each attached session | Runs | Cross-site frame | Service worker |
| --- | --- | --- | --- |
| `Network.enable`, `Target.setAutoAttach`, and `Runtime.runIfWaitingForDebugger` sent together | 3 | Never loads: its document request starts on the page's session and never finishes, nothing inside the frame is requested, and `wc.loadURL` has not resolved at the 15-second deadline | Runs: its script finishes on its session; its fetch finished in two runs and in the first reported data but no `loadingFinished`, as did the page's worker's fetch |
| Each command sent once the one before it answered | 3 | Loads; in the first run the frame's `fetch` and both workers' fetches reported data but no `loadingFinished`, and in the other two every request finished | Paused for good: its `Network.enable` never answers and its script is never requested |
| By type: on an `iframe` or `worker`, `Network.enable` and `Target.setAutoAttach` together, then the resume once both answered; on a `service_worker`, all three together | 9 | Loads | Runs |

In each of the nine runs of the third order the frame loaded and every request the servers logged
finished on a session. One run had no service worker, one had a worker that claims the page and
serves a `fetch` by fetching it again, and two used fetches that did not read their bodies. In the
claiming run one server request gave two exchanges: one on the page's session whose
`Network.responseReceived` reports `fromServiceWorker`, and the worker's own fetch on its session
under another request id. `Network.dataReceived` events arrived on every session, and the setup
answers on a frame or a dedicated worker arrived within 50 ms in every run. Not traced: why the
first order stalls a frame in Electron.

**The attach.** Step 9, after `Network.enable` on the page and before it loads the target:

1. Sends `Target.setAutoAttach` with `autoAttach`, `waitForDebuggerOnStart`, and `flatten` true on
   the page's session, and waits for its answer within the bound of the page's `Network.enable`.
   `wc.debugger.sendCommand` takes a session id as its third argument and its `message` event
   reports one, which is how a child session reaches the collector. If the answer fails or does not
   arrive, the record is kept and the page counts in `unrecordedTargets` (The two counts).
2. On each `Target.attachedToTarget` whose `targetInfo.type` is `iframe` or `worker`, sends
   `Network.enable` with the same limits and the same `Target.setAutoAttach` together on that
   session (so a target's own frames and workers attach the same way), waits for both answers within
   the child setup bound, and then sends `Runtime.runIfWaitingForDebugger`. The bound is a constant
   step 9 defines beside the page's `Network.enable` bound; this plan proposes 2 seconds, the value
   the scratch script used, and the target stays paused for at most that long. Sending the resume
   with the other two stalled the cross-site frame in every run above.
3. On each `Target.attachedToTarget` whose type is `service_worker`, sends the same three commands
   together without waiting. Waiting for the service worker's `Network.enable` before resuming it
   left it paused in every run above.
4. Resumes each target once, by item 2 or 3, whatever its commands answered. A target whose
   `Network.enable` or `Target.setAutoAttach` failed or did not answer within the bound counts in
   `unrecordedTargets` (D4). Its requests may still arrive and are recorded: in launched Chrome a
   late enable took effect after the tab resumed
   ([launched-browser probe](../specs/2026-10-11-capture-engine-launched-browser-probe-spike.md),
   P4). The protocol notes a deadlock for one waiting order (the probe's P4 cites the note), and in
   that probe an awaited enable left a tab paused for 15 seconds; in Electron the wait is what lets
   a cross-site frame load. The order is therefore per target type and per host, measured on one
   fixture (Risks).
5. Resumes a target of any other type at once, without recording it, and counts it in
   `unrecordedTargets`. A target that attaches after collection stops is resumed at once and is
   neither recorded nor counted, since collection has ended for every session.
6. Fetches each body on the session that reported its `loadingFinished`. A target that detaches
   before its body arrives leaves the body omitted (`bodiesOmitted`), and its unfinished requests
   count as in flight.
7. Bounds the body bytes it fetches, across every session, at `budget.totalBytes`. The engine counts
   a body against the cap when it sends `Network.getResponseBody` for it, at the sum of the
   `dataLength` its `Network.dataReceived` events reported, so bodies still in flight count before
   they return. It sends no request that would take that total past the cap, and counts each body it
   does not fetch in `bodiesOmitted`. When a body returns, the engine replaces its estimate with the
   length of the returned string. That string can be longer than `dataLength`: a binary body returns
   base64-encoded, about four thirds of its decoded size. The engine therefore estimates a body as
   four thirds of its `dataLength`, rounded up to a multiple of four, whenever it cannot tell in
   advance that the body will return as text, so a returned body does not take the total past the
   cap. Each session's `Network.enable` gets the same `maxTotalBufferSize` and
   `maxResourceBufferSize`; whether the browser applies those per session or across sessions was not
   measured, so the engine's cap is what bounds the total. D4's `budget` then states the total and
   per-resource limits the record was kept under, and its shape does not change.

**The two counts.** A target is the page or one `Target.attachedToTarget` session, and each target
collection saw is in exactly one count. `recordedTargets` is the page when its
`Target.setAutoAttach` answered, plus each attached `iframe`, `worker`, or `service_worker` target
whose `Network.enable` and `Target.setAutoAttach` both answered within the child setup bound.
`unrecordedTargets` is every other target: the page when its `Target.setAutoAttach` failed or did
not answer, each such attached target whose commands failed or did not answer, and each target of
another type (item 5). The page counted there still has its own requests recorded; the count says
that what runs below it may not have been seen, since an auto-attach that answers after the bound
may still take effect, as item 4 says of a child's late enable. Both are non-negative integers. Step
9's attach code knows which targets answered and passes that set to step 7's collector with the
`Target.attachedToTarget` events, and the collector computes both counts (step 7, #1903). Step 7
moves `unrecordedTargets` with a stream in which a child's enable never answers and one in which the
page's auto-attach fails; step 9 moves it with stubbed failures of both.

**Ruling E for a child session.** Ruling E keeps the Capture with the Transaction Record absent as
`failed` when `Network.enable` fails. D17 reads the ruling as the page's own `Network.enable`: when
that fails, the record is absent as `failed`, as ruled. When the page's `Target.setAutoAttach`, or a
frame's or a worker's session, fails, the record is kept and the target counts in
`unrecordedTargets`. This narrows ruling E and is part of what the maintainer approves with D17.

**The collector.** Step 7's input is session id, method, and params triples, plus the
`Target.attachedToTarget` events and the set of targets whose setup answered. It keys an exchange
by request id across sessions, because a frame's or a worker's first request starts on the parent's
session and ends on the child's, and a worker's `ExtraInfo` events arrive on the parent's. A page
request a service worker answers and the worker's own fetch for it carry different request ids, so
they are two exchanges, each as its session reported it. Step 0's committed streams carry no
session id; step 7 reads them as the page's session and adds multi-session sequences built on the
readings above.

**What the record still does not hold**, stated beside the capability in `features.mdx` with the
in-page reuse (D4):

- Requests a shared worker makes. It does not attach to the page's session, so none of its own
  requests reach the engine and the inventory cannot count them.
- Targets below a target whose `Target.setAutoAttach` failed. The failing target, the page
  included, counts in `unrecordedTargets`; whatever would have attached below it is never seen.

Both are exchanges the record lacks that the inventory does not account for one by one. ADR-0035
has the inventory account for every exchange a Transaction Record lacks, so these two limits depart
from it, and that departure is part of what the maintainer approves with D17.

**Risks.** `flatten` is marked experimental in `devtools-protocol`, as the stage 2 spec records of
the same command ([stage 2 spec](../specs/2026-10-10-capture-engine-launched-browser-design.md),
Attach before request). The order per target type rests on one fixture on one Linux host, and why
the other orders fail was not traced. Step 9's e2e spec loads a page with a cross-site frame,
dedicated workers in the page and in the frame, and a service worker, and checks every request the
fixture serves is an exchange. CI runs it on every pull request that changes a path outside its
documentation-only list (`.github/workflows/ci.yml`, the `changes` job); an Electron update changes
the lockfile, so a Chromium change that breaks the attach or the order fails there. Playwright
attaches its own debugger to the app in every e2e run, and whether a target paused for the engine
also waits on Playwright was not measured; the same spec shows it. Bound TLS Details stay the main
document's (D7).

## The spec's open questions

The maintainer ruled on questions 1 and 2 on 2026-10-10, each as this plan recommended. Questions
3 to 5 rest on fields of D4: the `budget` record, the `cached` count, and the `webSockets` count,
which the maintainer accepted with D1 to D7 (open question D). That settles this slice's answer to
question 5; whether WebSocket frames belong in the record stays a later decision, as the spec says.
The parts of questions 3 and 4 that no signed field fixes, the step 9 values and the
`features.mdx` statement, stay recommendations until the plan is approved. Each section keeps the
evidence behind its answer.

### 1. Decoded bodies under original headers

**Ruled 2026-10-10:** rename `Content-Encoding` and `Transfer-Encoding` to
`x-orig-content-encoding` and `x-orig-transfer-encoding` with their values kept, write the stored
length as `Content-Length`, and keep the reported length as `x-orig-content-length`. The writer
states the renaming in `warcinfo` (D8), and step 9 states it in `features.mdx`.

The spec asks what browser-based archiving tools write, and to follow it if it is documented (spec,
Open questions). This plan found no published statement, and the two Webrecorder recorders differ
in code:

- browsertrix-crawler renames `transfer-encoding` always, and `content-encoding` whenever the body
  it holds is decoded, to `x-orig-` names, and replaces `content-length` with the stored length
  (`src/util/reqresp.ts` at `b8c38c4d`, `_getHeadersDict` and `excludeHeader`).
- archiveweb.page drops `content-encoding` and `transfer-encoding` and replaces `content-length`
  (`src/requestresponseinfo.ts` at `595664ca`, `EXCLUDE_HEADERS` and `_getHeadersDict`).

[WARC 1.1](https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/) defines
the payload of an `application/http` block as its entity-body in the sense of RFC 2616 (section
`WARC-Payload-Digest`). After the rename, the record's HTTP message carries no content coding, so
the decoded body is its entity-body and the payload digest covers what the record holds. A reader
that decodes by header then does not try to inflate a body that is already decoded; for `warcio`,
"the default behavior is to decode transfer and content encoding" (its README, Accessing WARC
Content). Keeping the values under `x-orig-` names fits ADR-0035's "The record states what the
browser reported".
`x-orig-content-length` is this plan's addition, which the ruling keeps: browsertrix-crawler
overwrites the reported length and keeps no copy.

### 2. Compression

**Ruled 2026-10-10:** `.warc.gz`, with each record its own gzip member, settled before step 1.

- WARC 1.1 Annex D, which is informative, recommends GZIP and says "this property should be
  exploited to compress each record of a WARC file independently", with the suffix `.warc.gz`. The
  same annex calls compression "an external decision".
- Evidence Packages and Case Archives are stored ZIP archives built in memory
  (`createStoredZip`), so an uncompressed Transaction Record ships at full size in every export and
  adds to that peak in full.
  The record holds decoded bodies, which can be larger than what crossed the wire: the probe's
  `gzip` text was 70 bytes on the wire and 4,200 decoded. No real page's sizes are measured yet.
- `warcio` writes gzip members when given `gzip: true` (its README, "Writing WARC Files"). The test
  reader inflates them with Node's `zlib`, which needs no dependency.
- The cost is in two name readers. The Case Archive import loop reads `.gz` as the extension, so
  an import that remaps a Capture's id would write its record under the old id, apart from its
  Capture. `parseArtifactFilename` matches neither new name today, so the orphan scan ignores a
  stray `.warc.gz` or `.pdf`. If it only added `gz` to its pattern, it would read the id as
  `{id}.warc`, find no Capture, and let `cleanOrphans` delete the file. Step 3 teaches both the
  two-part extension, with tests, before any Capture has the file.
  `fileExt` in `caseArchive.ts` names only non-Capture Exhibit and pooled files and needs no
  change.
- Installed importers are not exposed: step 3 bumps `CASE_ARCHIVE_SCHEMA_VERSION`, and
  `inspectCaseArchive` in an older build refuses a newer archive with "Update Birdbrain to import
  it".
- The digest covers the stored bytes either way (spec, Open questions). `warcio` compresses through
  `CompressionStream` when the runtime has it and `pako` otherwise, so the compressed bytes can
  differ between runtimes. That does not affect verification, which hashes the stored file, or the
  payload digests, which cover the decoded bodies.

The alternative is `.warc`, uncompressed: no splitter changes, and
[WACZ 1.1.1](https://specs.webrecorder.net/wacz/1.1.1/) accepts either ("SHOULD use the `.warc`
file extension unless they are GZIP encoded in which case they MUST use the `.warc.gz` file
extension", section `archive`). Its cost is size in every export. Deflating the ZIP container
later would recover that for Evidence Packages, which a recipient opens with standard tools, but
not for Case Archives, whose installed importers read stored entries only.

### 3. Size budget

**Recommendation:** choose the values in step 9, as the agent briefs plan allows. Step 1 records the
budget in the inventory (D4), so later changes need no schema step.

Step 9 starts from the only values run so far, `maxTotalBufferSize` 50,000,000 and
`maxResourceBufferSize` 10,000,000 bytes (the probe script's `Network.enable` call), holds them in
`src/shared/constants.ts`, and reports the record sizes its fixture pages and the demo fixture pages
(`scripts/demo-fixture/pages/`) produce. Three facts bound the choice. The protocol definition marks
both parameters experimental. `Network.getResponseBody` hands each body to the main process as one
string, and the main process also runs the Capture Server and the database. An export holds every
file in memory before writing, and the 200 MB MHTML limit (`MAX_MHTML_SIZE`) is the ceiling MHTML
already has.

### 4. Cached responses

**Recommendation:** leave them to the inventory's `cached` count, and state the in-page reuse limit
in `features.mdx`.

Each render's partition is new and held in memory, so no earlier render can leave a cache entry
behind; only reuse inside the same render remains. A resource used twice inside one page leaves no
network event at all (probe spike), so no count can include it. Step 0 checks whether a fixture can
produce a cache event in a fresh partition at all (risk 4).

### 5. WebSocket traffic

**Settled for this slice by the open question D ruling (2026-10-10):** the inventory counts the
connections (`webSockets`, D4), so a page that opened one never reads as fully recorded (ADR-0035,
Decision). Frames stay out of this slice, as the spec says, and whether they belong in the record
stays a later decision. The count had to be settled before step 1, because it is a signed field.

## The `warcio` licence and the test readers

The maintainer ruled on this gate (the agent briefs plan, gates table) on 2026-10-10. The licence
and test-reader rulings follow this plan's recommendations. The scope of the 2026-10-02 approval
(open question G) and the upstream request, which this plan left to the maintainer, are the
maintainer's own rulings. Facts, read 2026-10-10:

- The npm registry declares `Apache-2.0` for every release from 2.4.5 to 2.4.12, the latest
  (published 2026-09-04), from the repository `webrecorder/warcio.js`, and so does the
  `package.json` inside the 2.4.12 tarball.
- The `LICENSE` file in the same tarball is the MIT text under "Copyright (c) 2020, Webrecorder
  Software", and GitHub reports the repository as MIT. The file arrived in commit `dc791823`
  (2020-06-09), when `package.json` already declared Apache-2.0. The tarball has no `NOTICE` file.
- 2.4.12 declares eight runtime dependencies: `pako` (`(MIT AND Zlib)` in the registry),
  `hash-wasm`, `base32-encode`, `tempy`, `uuid-random`, and `yargs` (each MIT), and
  `@types/pako` and `@types/stream-buffers` (MIT). The lockfile decides the transitive set.

**Licence ruling.** Birdbrain takes the package under both texts. Step 8 adds an `overrides.json`
entry for `warcio` with `append: true`, a note stating the disagreement, and a new
`texts/Apache-2.0.txt`, the pattern the `@img/sharp-win32-arm64` entry follows. The packaged notice
then carries the MIT text the package ships and the Apache-2.0 text it declares. Birdbrain itself is
MIT (`package.json`). The 2026-10-02 approval of `warcio` covers its eight runtime dependencies and
the transitive set the lockfile adds (open question G). The maintainer makes no upstream request to
reconcile the two texts now. Reading both licences as satisfiable together is not a legal review.

**WARC test reader.** **Ruled 2026-10-10:** a reader written in the package's own tests, with no
dependency. It frames records by `Content-Length`, inflates each gzip member with Node's `zlib`,
reads the `WARC/1.1` headers, and recomputes `WARC-Block-Digest` and `WARC-Payload-Digest` without
importing `warcio`: the independent path ADR-0004 asks for. Step 9 adds a manual check to the
validation record, `warcio check` from the separate Python implementation (1.8.1 on PyPI, Apache
2.0), whose PyPI description says it checks the payload and block digests. `node-warc` 3.3.1 (MIT)
was last published on 2019-02-24 and is not recommended.

**PDF parser.** Without a parser, a blank PDF passes every automated test, and a known answer for
the PDF is that it holds the page. **Ruled 2026-10-10:** `pdfjs-dist` 5.6.205 as an exact-pinned
devDependency (Mozilla's pdf.js, Apache-2.0, no required dependencies; optional `@napi-rs/canvas`
and `node-readable-to-web-readable-stream`). It is the last release whose `engines.node` admits Node
20 (`>=20.19.0 || >=22.13.0 || >=24`); from 5.7.284, the latest being 6.4.299, it declares
`>=22.13.0 || >=24`, outside the Node 20 the toolchain pins. Tests run on Electron 44.5.1's Node
24.21.0. Dependabot then needs an ignore entry for 5.7 and later, as `dependency-cruiser` has, and
the ruling includes it.

## Order of work

Each numbered step is one pull request. Step 0 is a docs-only spike. "Release" means a tagged
release that carries step 1's verifier.

| Step | Brief | Change | Lane held | Blocking-tier paths | Files | Waits for |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | new | Renderer spike (docs only) | none | none | 2 | nothing |
| 1 | CE-5 | Verifier and schema: D1 to D3, D14 | Manifest schema | `src/shared/verify/**`, `src/verifier/**`, `manifest.ts`, the layout package (row added) | 12-14 | Plan approval, the lane, step 0 |
| 2 | CE-6 | Mirror columns (D9) | Migration | `db/**` | 6-8 | Step 1, the lane |
| 3 | CE-9, Case half | Store, Case Archive, Duplicate, deletion, orphan scan, `verifySidecars` | Case Archive | `captureStore.ts`, `caseArchive.ts`, `captureLifecycle.ts`, `db/**` | 9-11 | Steps 1 and 2, the lane |
| 4 | CE-7 and CE-8, export halves | Package placement, `evidence.json`, `verify.sh`, `VERIFY.md` | none | `export.ts`, `verifyScript.ts`, `verifyRunbook.ts` | 5-7 | Steps 1 and 3 |
| 5 | CE-9, report half | `report.html` states the new fields | none | `reportHtml.ts` | 3-4 | Step 2 |
| 6 | CE-8, first part | Scroll-to-load and screenshot record | none | `backgroundRenderer.ts`, `recapture.ts`, `captureLifecycle.ts` | 7-9 | Release, steps 2, 3, and 5 |
| 7 | CE-7, first part | Exchange collector and Bound TLS conversion (pure) | none | the new package (row added) | 6-8 | Plan approval, step 0 |
| 8 | CE-7, second part | WARC writer (pure), `warcio`, notice override | none | the package | 7-9 | Step 7 |
| 9 | CE-7, wiring | Record the Transaction Record and Bound TLS Details; probe script (D15) | none | `backgroundRenderer.ts`, `recapture.ts`, `captureLifecycle.ts` | 10-12 | Release, steps 3 to 8, CE-2, CE-3 |
| 10 | CE-8, last part | PDF | none | `backgroundRenderer.ts`, `recapture.ts`, `captureLifecycle.ts` | 6-8 | Step 9 |

File counts are estimates, not taken from a prototype. Steps 2 to 5, 7, and 8 write no new field
from acquisition, so they may merge before the release (open question A, ruled 2026-10-10). Steps
6, 9, and 10 are the writers; each merges only after the release.

Every code step ends with `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` and `pnpm preflight` at head,
with exit codes captured. `pnpm test <path>` takes no `--`. Locally, the e2e suite needs the offline
recipe while a running Birdbrain holds port 19845 (#1693, Verification). A step that edits
`CONTEXT.md` or `features.mdx` also runs `.claude/hooks/vale-prose.sh --base origin/main` and, from
`website/content/`, `pnpm dlx mint broken-links`.

### Step 0. Renderer spike (docs only)

- **Changes.** Nothing merges but the doc and the recorded event streams. On a scratch branch,
  `renderPageInHiddenWindow` loads `about:blank`, sends `Network.enable` with the probe's limits,
  loads the target, and records every `Network` event. The spike then answers seven questions:
  1. Do `e2e/recapture.spec.ts` and `e2e/recapture-consent.spec.ts` still pass with the domain on?
     This tests the comment from #180.
  2. Which requests reach the fixture server during `wc.savePage`? The answer fixes where collection
     stops.
  3. How does a request the consent filter cancels arrive: `loadingFailed` with `canceled`, with
     `blockedReason`, or another way?
  4. Do the requests of a cross-site iframe (for example, a page on `127.0.0.1` framing one on
     `localhost`), and both hops of a main document redirected between two loopback ports, appear
     on `wc.debugger`? Does the iframe run in its own renderer process?
  5. Can a fixture produce `Network.requestServedFromCache` or a `fromDiskCache` response in a fresh
     partition?
  6. Served over HTTPS with a generated certificate, accepted through a test-only
     `setCertificateVerifyProc` on the render's session, does the main document's
     `Network.responseReceived` carry `securityDetails`, and do its field names match D7 on
     Chromium 152? The spike records the `keyExchange`, `keyExchangeGroup`, and `mac` values it
     sees.
  7. What does the target read as `history.length`? A scratch run for this plan read 2 after
     `about:blank` and 1 without it (Probe rerun on Electron 44.5.1). Can the renderer remove the
     `about:blank` entry before the target's document commits, for example with
     `wc.navigationHistory.clear()`, so the target reads 1? If no way works, step 9 records the
     difference as a known limitation in the D16 validation record and in `features.mdx` beside
     the capability, and D15's script expects it.
- **Deliverable.** `docs/specs/2026-10-NN-capture-engine-renderer-spike.md`, with the commands, the
  output, and a verdict for each question. The recorded `Network` event streams are committed
  beside it as a JSON file (proposed name
  `docs/specs/2026-10-NN-capture-engine-renderer-spike-events.json`), which step 7 copies into
  `src/packages/transaction-record/tests/fixtures/`. A scratch branch cannot be the source: the
  teardown sweep removes local branches (`docs/agents/worktrees.md`). Fixture content is invented.
- **Done when.** Each question has an answer from a run. If question 1 fails, the doc says so and
  step 9 needs an Electron-run harness shaped like the probe. If question 4 shows an iframe's
  requests missing, step 1 stops: the inventory needs a design for child targets, which goes to the
  maintainer. Question 4 found them missing, and the maintainer ruled on 2026-10-17; the design is
  D17. If question 6 shows no `securityDetails`, step 1 leaves `boundTls` out and Bound TLS
  Details go back to the maintainer.
- **Verify with.** `.claude/hooks/vale-prose.sh --base origin/main`.

### Step 1. Verifier and schema (CE-5)

- **Waits for** the maintainer's approval of D17, whose two counts it freezes with the rest of D4.
- **Changes.** D1, D2, D3, and D14 in `src/shared/schemas.ts`, `src/shared/types.ts`,
  `src/shared/constants.ts`, `manifest.ts` (`ManifestEntryInput`, `fieldMinReaderSchemaVersion`,
  `CaptureEntryContext`, `withCaptureEntry`), `manifestChain.ts` (`CaptureChainEntry`),
  `evidencePackage.ts` (a file check for each new hash, after the screenshot's), and the layout
  package (`lib/paths.ts`, `lib/shell.ts`, `index.ts`). The standalone verifier picks both up
  through `verifyEvidencePackage`. No app code sets a new field. The pull request adds
  `src/packages/evidence-package-layout/**` to the assessment's blocking tier.
- **Package Verification rows.** `capture <id> transaction record` and `capture <id> pdf`: SKIP for
  an absent hash, PASS for a matching file, FAIL otherwise. A third row,
  `capture <id> transaction record headers`, is a SKIP that reports an entry fact, like the Egress
  rows (`describeEgress` in `evidencePackage.ts`): it quotes
  `inventory.transactionRecord.replacedHeaders` and states that the record holds those headers
  with their values replaced. ADR-0036 requires it: "the glossary and the verifier say so: the
  headers are present, their values are not" (ADR-0036, Consequences). Behind a failed manifest
  chain the row reports the names as unverified, as the Egress row does, and an entry with no
  Transaction Record adds no row. No string the verifier prints calls the Transaction Record
  complete, a packet capture, or bytes from the wire (ADR-0035, Decision; spec, What the record is
  and is not).
- **Done when.** A fixture `capture` entry carrying every D1 field verifies in the app verifier and
  the standalone verifier, and a frozen digest for it passes (the #1747 known-answer pattern). Its
  body hashes the same through `canonicalStringify` and the `jq -cS` recipe. A fractional number in
  a new field fails the schema. A `boundTls` with `keyExchange` `''`, `keyExchangeGroup` present,
  and `mac` absent passes the schema. A test pins the text of the headers row, and of its
  unverified form. Every existing frozen digest and fixture package verifies unchanged. A reader
  at the previous schema number meets the fields and reports "verifier too old", never a broken
  chain. Each D2 refine rejects its contradicting shape with a named error. In
  a fixture package, a changed byte in either file fails, a missing file fails, and an absent hash
  skips. The new path functions pass the layout package's literal guard test.
- **Verify with.** `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/shared/verify`,
  `pnpm test src/packages/evidence-package-layout/tests`, `pnpm build:verifier`, then
  `pnpm test tests/verifier/binary.test.ts` (it skips when the binary is not built,
  `describe.skipIf(!haveBinary)`), `pnpm lint:boundaries`, then `pnpm preflight`.
- **Revert.** Free until a release carries it. After that, the fields are permanent in every
  distributed verifier.

### Step 2. Mirror columns (CE-6)

- **Changes.** `pnpm db:migration:new capture-engine-fields` scaffolds the next migration and bumps
  `LATEST_SCHEMA_VERSION`. The migration adds the D9 columns; `CAPTURE_COLUMNS`, the `Capture` type,
  and the row mapping follow.
- **No Case Archive bump here.** An older importer drops the new columns, but every one is null until
  step 6 writes it, so nothing is lost. Step 3 bumps the version once for the columns and the files,
  and merges before any writer (open question B, ruled 2026-10-10).
- **Done when.** The migration test shows the six nullable TEXT columns, the `CAPTURE_COLUMNS` drift
  test passes, and a Capture row with every new column set survives a Case Archive round trip.
- **Verify with.** The new migration test (proposed name
  `tests/main/services/captureEngineColumnsMigration.test.ts`),
  `pnpm test tests/main/services/caseArchiveRoundTrip.test.ts`, then `pnpm preflight`.
- **Revert.** Before a release only. A profile that ran the migration keeps the columns, and the
  read-only connection the MCP server opens refuses a schema version the build does not know
  (`openDatabaseReadOnly` in `db/core.ts`).

### Step 3. The Case handles the two files (CE-9, Case half)

- **Changes.** `CaptureArtifactType` gains the two types and write methods for them
  (`captureStore.ts`). One rule for a two-part extension serves `parseArtifactFilename` and the
  Case Archive import loop. Duplicate follows D11. `verifySidecars` checks both hashes. The orphan
  scan reports a stray `.warc.gz` or `.pdf`, and never reports a Capture because its Transaction
  Record or PDF file is missing (open question F). `CASE_ARCHIVE_SCHEMA_VERSION` takes the next
  number, and its comment names the step 2 columns and the two files.
- **Done when.** The store writes, reads, copies, stages, restores, and deletes both files, with a
  test each. A Case Archive round trip carries both files, including for a Capture whose id the
  import remaps. A Case Archive header from this build states the new version, and an importer at
  the previous `CASE_ARCHIVE_SCHEMA_VERSION` refuses it with its "Update Birdbrain" message.
  `parseArtifactFilename` maps both names to the Capture id; the orphan scan reports a stray
  `.warc.gz` and `.pdf` and never reports a live Capture's file. A Capture whose Transaction Record
  or PDF file is missing stays out of the scan's report, so `cleanOrphans` leaves its files and
  row in place, and `verifySidecars` reports it as `missing`. A Duplicate of a source whose entry
  carries the D1 fields copies both files, re-anchors the fields D11 names, writes no Bound TLS
  Details, and refuses a copy whose bytes differ. `verifySidecars` reports a
  changed file as `tampered` and an absent one as `missing` (the #1661 pattern). Fixtures are
  hand-made bytes, because nothing acquires the files yet.
- **Verify with.** `pnpm test tests/main/services/captureStore.test.ts`,
  `pnpm test tests/main/services/caseArchiveRoundTrip.test.ts`,
  `pnpm test tests/main/services/captureDuplicate.test.ts`,
  `pnpm test tests/main/services/dbAdmin.test.ts`,
  `pnpm test tests/main/services/captureLifecycle.test.ts`, then `pnpm preflight`.
- **Revert.** No Capture has either file until step 9, so a revert before then strands nothing.

### Step 4. Evidence Packages carry the two files (CE-7 and CE-8, export halves)

- **Changes.** `export.ts` places both files at the D3 paths and lists them in `evidence.json`
  beside `screenshotPath` and `screenshotSha256`. `verify.sh` binds them in its content bind step,
  beside the screenshot, and `VERIFY.md` names them there. `VERIFY.md` step 5 also says that the
  Transaction Record holds the four credential headers with their values replaced: the headers
  are present, their values are not, and a token in a URL, a body, or any other header stays in
  the record (ADR-0036, Consequences). The step list in
  `verifyProcedure.ts` does not change, so the procedure keeps six steps.
- **Done when.** A package exported from a hand-made Capture carrying both hashes ships both files
  at the D3 paths, and Package Verification passes in the app and under the standalone verifier. A
  changed byte in either file, or a missing file, fails Package Verification and fails `verify.sh`
  under `runVerifyScript`. A package from a Capture without them has the same members as today.
- **Verify with.** `pnpm test tests/main/services/export.test.ts`,
  `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test tests/shared/verify/evidencePackage.test.ts`,
  `BIRDBRAIN_REQUIRE_OPENSSL=1 BIRDBRAIN_REQUIRE_JQ=1 pnpm test tests/main/services/verifyRunbookExecution.test.ts`
  (it runs `verify.sh` through `runVerifyScript` only when `openssl` and `jq` are present, and it
  imports sharp, so on Linux the sharp note in step 6 applies), then `pnpm preflight`.
- **Revert.** Strands nothing before step 9.

### Step 5. The report states the new fields (CE-9, report half)

- **Changes.** `reportHtml.ts` states, for each Capture whose signed entry carries them: every file
  present or absent with its reason, the Transaction Record counts, the Scroll-to-load outcome, the
  screenshot's scaled, truncated, and trimmed state, and Bound TLS Details. `export.ts` resolves
  these fields from the same manifest snapshot `resolveEntrySignatures` reads, keyed by capture id,
  and never from the step 2 columns, which Settings -> Database can hand-edit (D9). Bound TLS
  Details get their own block, apart from the TLS Cert Chain's "Corroboration only" note, and are
  described as the browser's summary of the captured transaction (`CONTEXT.md`, Relationships). The
  wording follows ADR-0035 and ADR-0036: the headers are present and their values are not, tokens
  in a URL, a body, or any other header stay in the record, and the record is never complete
  beyond what the inventory supports.
- **Not here.** Display in the app (`ForensicsTab.tsx` and the Data screen) is #1816, filed to
  follow CE-8 (steps 6 and 10): it shows the Egress, the inventory, the Scroll-to-load outcome, and
  Bound TLS Details on a Capture, kept apart from the TLS Cert Chain view.
- **Done when.** A report for a Capture carrying every field renders each of them, a report for a
  Capture without them renders as today, a report for a Capture whose step 2 columns were edited
  after ingest states the signed entry's values, and no new wording calls the Transaction Record
  complete or uses an unqualified assurance word (`docs/agents/writing-guide.md`, Claim
  discipline).
- **Verify with.** A new report test beside `tests/main/services/reportLayoutInvariants.test.ts`,
  then `pnpm preflight`.
- **Revert.** Strands nothing.

### Step 6. Scroll-to-load and the screenshot record (CE-8, first part)

- **Changes.** `scrollToLoadLazyContent` returns its D5 record. `captureFullPageScreenshot` and
  `trimTrailingBackground` return the D6 facts. `RenderedPage` and the ingest parameters carry them,
  and ingest writes `scrollToLoad` and an `inventory` with MHTML and the screenshot present and the
  Transaction Record and PDF absent as `not-taken`, plus the row mirror. The step starts the D16
  validation record. `CONTEXT.md` rewrites the Scroll-to-load clause to say that `background`
  Captures record the phase today, and keeps _Planned_ on the extension's half (CE-S3). It rewrites
  the Capture clause to say that `background` Captures carry the inventory today, and keeps
  _Planned_ on the inventory for other Capture Methods and on the Transaction Record and PDF.
  `CONTEXT.md` is the glossary, and the writing guide forbids describing unshipped behaviour in
  the present tense (`docs/agents/writing-guide.md`, Claim discipline). `features.mdx` updates its
  Capture section. Carried from #1982 (step 3): the step that adds the `inventory` and
  `scroll_to_load` columns to `InsertCaptureParams` also has Duplicate's `insertCapture` call
  pass both from the source's signed entry, as it passes `screenshotHash` (step 9 lists all four
  fields).
- **Done when.** Unit tests drive `scrollToLoadLazyContent` through each ending in D5 with a mocked
  `WebContents`, and the screenshot functions through scaled, truncated, trimmed, and none. An e2e
  Recapture of an invented fixture page records `stopped-growing`, its height, and the screenshot
  facts in the entry and the row. `e2e/recapture.spec.ts` still passes. This records the background
  half of #1667, which then closes; its extension half closes in favor of CE-S3 (ruled
  2026-10-10).
- **Verify with.** `pnpm test tests/main/services/backgroundRenderer.test.ts` (on Linux, run
  `pnpm build:test-sharp` first and set `BIRDBRAIN_TEST_SYSTEM_SHARP=1`, because the test imports
  sharp; see "sharp under Electron on Linux" in `docs/agents/testing.md`),
  `pnpm test tests/main/services/recapture.test.ts`,
  `pnpm test tests/main/services/captureLifecycle.test.ts`,
  `pnpm test:e2e e2e/recapture.spec.ts`, the docs checks, then `pnpm preflight`.
- **Revert.** Captures written in the meantime keep fields that the released verifier reads and
  steps 3 to 5 carry.

### Step 7. Exchange collector and Bound TLS conversion (CE-7, first part)

- **Changes.** Creates `src/packages/transaction-record/` with `collector.ts` (CDP `Network`
  events in, as recorded session id, method, and params triples, with the `Target.attachedToTarget`
  events and the set of targets whose setup answered (D17, "The collector"); exchanges and the D4
  counts out) and `boundTls.ts` (a `securityDetails` object in, D7's `boundTls` out, times as ISO
  strings). The pull request adds
  `src/packages/transaction-record/**` to the assessment as a blocking row.
- **Done when.** From the event streams step 0 committed and from sequences built on the probe's
  observations: each redirect hop becomes its own exchange under a reused request id; a frame's
  document request that starts on the page's session and finishes on the frame's is one complete
  exchange; a stream in which a child's enable never answers, and one in which the page's
  auto-attach fails, each move `unrecordedTargets` (D17); each count in D4 has a sequence that
  moves it, and none of those exchanges is counted as complete; the output order is deterministic. The step defines how it tells an incomplete request body from a complete
  one, with a multipart sequence as its test. A recorded `securityDetails` object converts to D7's
  shape with no fractional number.
- **Verify with.** `pnpm test src/packages/transaction-record/tests`, `pnpm lint:boundaries`, then
  `pnpm preflight`.
- **Revert.** Nothing calls it before step 9.

### Step 8. WARC writer (CE-7, second part)

- **Changes.** Adds `writer.ts` (exchanges in; `.warc.gz` bytes and the replaced header names out)
  per D8, the `warcio` dependency, the notice override with `texts/Apache-2.0.txt`, and the test
  reader.
- **Done when.** The test reader parses the writer's output and every block and payload digest
  holds. Each payload digest equals the SHA-256 of the decoded fixture payload, for a body served
  with `gzip` and one served plain. A redirect has a `response` record with headers and no body.
  For each row of D8's partial-exchange table, a fixture exchange gets the records the row names,
  and no partial exchange is written as a complete response or as a complete empty one. For a
  fixture that carries `Cookie`, `Set-Cookie`, `Authorization`, and `Proxy-Authorization` values,
  with mixed-case header names, in every header source CDP offers, including both `ExtraInfo`
  events and the cookie arrays, no byte of the inflated output holds any of the values, and
  `replacedHeaders` names each of the four. The `x-orig-` renames and the pseudo-header rule hold.
  `warcinfo` holds the four spec facts and the two fixed statements, and no host name, address, or
  proxy. No `WARC-IP-Address` appears when the input says the Egress is not Direct.
  `pnpm build:notices` passes. `pnpm build` does not show that `warcio` loads in the app, because
  electron-vite leaves production dependencies external in the main process
  (`externalizeDepsPlugin` in `electron.vite.config.ts`); step 9's e2e spec, which runs against
  the `pnpm build` output, loads it.
- **Verify with.** `pnpm test src/packages/transaction-record/tests`, `pnpm lint:boundaries`,
  `pnpm build:notices`, then `pnpm preflight`.
- **Revert.** Nothing calls it before step 9; the revert also removes the dependency.

### Step 9. Record the Transaction Record and Bound TLS Details (CE-7, wiring)

- **Changes.** In `renderPageInHiddenWindow`: CE-3's proxy on the partition before the first
  navigation, then attach, load `about:blank`, send `Network.enable` with the budget under a bounded
  wait, set up D17's attach for frames, dedicated workers, and service workers in its order per
  target type, remove the `about:blank` entry if step 0 question 7 found a way, and load the
  target. The collector reads `wc.debugger` `message` events; each body is fetched when its
  `loadingFinished` arrives, if D17's body cap, which counts bodies still being fetched, leaves
  room for it; collection stops at the point step 0 question 2 fixes and the spike records. The
  spec puts that point "at the moment the screenshot and MHTML are taken" (spec, Transaction
  Record). The writer's output, the inventory part, and the main document's `securityDetails`
  travel on
  `RenderedPage`. Ingest writes the file through step 3's store method, `transactionRecordHash`,
  `boundTls` or `boundTlsAbsent`, the inventory part, and the row. If `Network.enable` fails or
  times out, the inventory records the Transaction Record absent as `failed`, `boundTlsAbsent` is
  `not-recorded`, and the Capture stores (open question E). The TLS Cert Chain re-fetch runs as
  today, and its field stays separate. The step also commits the D15 probe script with its
  command and expected output, and extends the validation record. `CONTEXT.md` rewrites the
  Transaction Record and Bound TLS Details clauses, and the Capture clause's mention of the
  Transaction Record, to say that `background` Captures carry them today, and keeps _Planned_ on
  the `launched` half (step 6 gives the reason). `features.mdx` states beside the capability that
  credential header values are replaced (ADR-0036), that a token in a URL, a request or response
  body, or any header not on the list stays in the record, so an export of a signed-in page can
  still hold a reusable credential (ADR-0036, Consequences), that a resource reused inside a page
  leaves no trace, the `x-orig-` renaming, and that Bound TLS Details are the browser's summary.
  It also adds the Transaction Record to the Integrity bullet that lists what Birdbrain hashes and
  to the Export bullet that lists what an evidence package contains. A test-only certificate
  allowance, from step 0's question 6, joins CE-2's loopback allowance, which a packaged build
  cannot turn on. Carried from #1982 (step 3): a Duplicate's row mirrors none of the four fields
  its signed entry re-anchors (`inventory`, `scroll_to_load`, `transaction_record_hash`,
  `pdf_hash`), because `InsertCaptureParams` has no mirror columns until a writer step adds them.
  Each writer step that adds one has Duplicate's `insertCapture` call pass it from the source's
  signed entry, as it passes `screenshotHash`: step 6 the first two, step 9
  `transaction_record_hash`, step 10 `pdf_hash`.
- **Time.** The render races one deadline and, when the deadline wins, rejects with "Recapture
  timed out" and stores nothing; `FINAL_ARTIFACT_RESERVE_MS` reserves 20 s for the screenshot,
  MHTML, and text only (`renderPageInHiddenWindow`). Two new phases need time at the end: the
  body fetches still pending when collection stops, and the writer. Step 9 raises the reserve by
  their time and gives each phase its own timeout inside it, so the 120 s Recapture timeout stays.
  It picks the values with the size budget (open question 3). When either phase times out or
  throws, the inventory records the Transaction Record absent as `failed`, `boundTlsAbsent` is
  `not-recorded`, and the Capture stores.
- **Done when.** Against a local fixture server reached through CE-2's loopback allowance, a new e2e
  spec shows the spec's known answers (spec, Validation): `gzip` and plain digests; a redirect,
  same-origin and cross-origin; failed, cancelled, in-flight, and over-budget requests; a
  cross-site frame with a dedicated worker of its own, a dedicated worker of the page, and a
  service worker, every request of which is an exchange, with `recordedTargets` counting them and
  stubbed failures of a child's setup and of the page's auto-attach each moving
  `unrecordedTargets` (D17); and a cached response if step 0 found
  a way to produce one. The consent filter's cancelled request is counted.
  Inventory counts match the server's request log, apart from the in-page reuse the probe
  documented and a page exchange a service worker answered, whose response reports
  `fromServiceWorker` (D17). A cookie the fixture sets and sends appears nowhere in the inflated record. For a
  fixture served over TLS with a known certificate, through that certificate allowance, `boundTls`
  matches its subject, SANs, issuer, and validity; an `http:` page writes `not-https`. With CE-3's
  SOCKS5 fixture and a proxy Egress, neither the record nor the inventory holds the proxy's host or
  port. `e2e/recapture.spec.ts` and `e2e/recapture-consent.spec.ts` still pass. A unit test in
  which a pending body fetch never settles, and one in which the writer throws, each store the
  Capture with the Transaction Record absent as `failed`, inside the Recapture timeout. A unit test
  shows that with the test switch absent, or with `app.isPackaged` true, the render installs no
  certificate allowance and a certificate signed by the fixture's test authority is refused, as
  CE-2's brief asks of its loopback allowance (the agent briefs plan, CE-2). The D15 script's
  command runs both passes and reports no difference beyond the one step 0 question 7 records. If
  SC-2 has merged, the two-peer `MemoryTransport` test passes for the record (open question C).
- **Verify with.**
  `pnpm test tests/main/services/backgroundRenderer.test.ts tests/main/services/recapture.test.ts tests/main/services/captureLifecycle.test.ts`
  (the sharp note in step 6 applies),
  `pnpm test:e2e e2e/recapture.spec.ts e2e/recapture-consent.spec.ts e2e/recapture-transaction-record.spec.ts`
  (the last is the new spec's proposed name), the D15 script's command, the docs checks, then
  `pnpm preflight`.
- **Revert.** Captures written keep their record, and steps 3 to 5 still carry it.

### Step 10. PDF (CE-8, last part)

- **Changes.** `webContents.printToPDF` runs after the screenshot, the MHTML, and the end of
  collection (spec, PDF). The print runs under its own timeout inside the reserve step 9 raised,
  which step 10 raises again by that timeout. Ingest writes the file, `pdfHash`, and the PDF part
  with `afterCollection: true`. A print that fails, throws, or times out records the PDF absent as
  `failed`, and the Capture stores. The PDF gets the size bounds MHTML and the screenshot already
  have (`MAX_MHTML_SIZE` and `MAX_SCREENSHOT_SIZE` in `src/shared/constants.ts`), because
  `printToPDF` returns the whole file as one `Buffer` in the main process and an export holds it
  in memory again. Before printing, the render skips the print when the page's `contentHeight`
  (D6) exceeds a layout bound; after printing, it discards a `Buffer` over `MAX_PDF_SIZE`. Both
  record the PDF absent as `failed`, the log names the bound, and the Capture stores. Both
  constants join `constants.ts`, with values chosen from the fixture sizes, as open question 3
  does for the Transaction Record. The step completes the validation record for the maintainer's
  acceptance. `CONTEXT.md` rewrites the Capture clause to say that `background` Captures carry a
  PDF today, and keeps _Planned_ on other Capture Methods; `features.mdx` updates Capture, and
  adds the PDF to the Integrity bullet that lists what Birdbrain hashes and to the Export bullet
  that lists what an evidence package contains. As the test-reader gate ruled on 2026-10-10, the
  step adds `pdfjs-dist` 5.6.205, exact-pinned, to `devDependencies`, and an `ignore` entry for
  `pdfjs-dist` with `versions: ['>=5.7']` to `.github/dependabot.yml`, beside the
  `dependency-cruiser` entry (outside the paths ADR-0048 holds). Carried from #1982 (step 3):
  Duplicate's `insertCapture` call fills the `pdf_hash` column from the source's signed entry
  once `InsertCaptureParams` has it (step 9 lists all four fields).
- **Done when.** With the probe's print-only image as a fixture, the image's request is absent from
  the Transaction Record. The stored file parses under `pdfjs-dist` as one page holding the
  fixture's text. A unit test in which `printToPDF` never settles stores the Capture with the PDF
  absent as `failed`, inside the Recapture timeout. A unit test with `contentHeight` over the
  layout bound never calls `printToPDF`, and one in which `printToPDF` returns a `Buffer` over
  `MAX_PDF_SIZE` writes no `.pdf` file; each stores the Capture with the PDF absent as `failed`.
  A package exported from the Capture verifies, and a changed PDF byte fails. If SC-2 has merged,
  the two-peer test passes for the PDF.
- **Verify with.**
  `pnpm test tests/main/services/backgroundRenderer.test.ts tests/main/services/recapture.test.ts tests/main/services/captureLifecycle.test.ts`
  (the sharp note in step 6 applies), `pnpm test:e2e e2e/recapture-transaction-record.spec.ts`
  with a PDF case added to it, the docs checks, then `pnpm preflight`.
- **Revert.** Captures written keep their PDF, and steps 3 to 5 still carry it.

## Lanes and hot files

**Each lane is held once.** Step 1 holds the manifest schema lane from opening to merge, after CE-3
and the schema steps ahead of it (the agent briefs plan, lanes table). Step 2 holds the migration
lane. Step 3 holds the Case Archive lane, and is this slice's only Case Archive bump (open question
B, ruled 2026-10-10). No writer step holds a lane.

**Proposed hot-file order**, replacing the agent briefs plan's CE-5 to CE-9 entries:

- `backgroundRenderer.ts`: CE-1, CE-2, CE-3, #1499, then steps 6, 9, and 10.
- `recapture.ts`: CE-2, CE-3, #1499, the link-capture writer, then steps 6, 9, and 10.
- `captureLifecycle.ts`: step 3 can land ahead of the agent briefs plan's order at rebase cost
  only; steps 6, 9, and 10 take the places of CE-7 and CE-8, after #1815, CE-3, CI-4, SC-2b, and
  CE-10, as in the agent briefs plan.
- `manifest.ts`: step 1 only. `export.ts`, `verifyScript.ts`, and `verifyRunbook.ts`: step 4 only.
  `caseArchive.ts`: step 3 only. `reportHtml.ts`: step 5 only.

**What runs at once.** Step 0 can start now. After approval, steps 1 and 7 share no file, and step
8 follows step 7. After step 1 merges, steps 2 to 5 run in order of their waits while the release
is pending. Under the review cap of two evidence-affecting pull requests (the agent briefs plan,
What limits parallelism), pairs such as 1 with 7, 2 with 8, 3 with 5, and 4 with 6 fit.

### What this changes in the agent briefs plan

| Brief | Here |
| --- | --- |
| CE-5 | Step 1, after step 0 |
| CE-6 | Step 2, without its Case Archive bump (open question B, ruled) |
| CE-7 | Steps 7, 8, and 9; its Evidence Package half moves to step 4, and step 9 does not wait for SC-2 (open question C, ruled) |
| CE-8 | Steps 6 and 10; its Evidence Package half moves to step 4 |
| CE-9 | Steps 3 and 5, moved ahead of the writers; the orphan scan reports only stray files, replacing "flags a Capture missing either" (open question F, ruled) |
| New | Step 0, a renderer spike before the verifier freezes the shapes |
| SC-2 | Builds its blob list from `CAPTURE_ENTRY_HASH_FIELDS` in `src/shared/verify/manifestChain.ts` (D2), whichever of SC-2 and step 1 creates it |

On 2026-10-10 the maintainer ruled on the parts marked ruled, and accepts the rest of each row
with the plan.

## Evidence impact

Every code step touches the blocking tier, so each is evidence-affecting: it gets the maintainer's
review, owes an Evidence impact section and known-answer tests, and never merges automatically (the
evidence-affecting paths assessment, Tiers). Each pull request says which evidentiary result can
change:

- Step 0 is docs only.
- Step 1 changes what Package Verification and the standalone verifier accept and report. Every
  existing entry keeps its canonical body and chain hash.
- Steps 2 to 5 change how the Case, Case Archives, Duplicates, Evidence Packages, and the report
  carry and describe files that no Capture has yet. Each says that in its Evidence impact section.
- Steps 6, 9, and 10 change acquisition and the signed entry. An entry from a build between step 6
  and step 9 states the Transaction Record and PDF as `not-taken`, which is true of that build and
  stays in the chain. The maintainer can hold the release tag until steps 6, 9, and 10 have all
  merged, so no released build writes that partial inventory.
- Steps 7 and 8 add the code that decides what enters a Transaction Record, including the values
  ADR-0036 keeps out of every file. Nothing calls it until step 9.

## Known-answer tests

| Spec validation item (spec, Validation) | Step |
| --- | --- |
| Payload digests equal the decoded fixture payloads, `gzip` and plain | 8 (recorded inputs), 9 (fixture server) |
| Redirect, cached, failed, cancelled, and over-budget each appear where the design says | 7 (recorded inputs), 9 (fixture server) |
| A reader that is not the writer parses the file | 8 |
| A changed byte in the Transaction Record or the PDF fails verification | 1 (fixture package), 4, 9, 10 |
| Entries written before this slice still verify | 1 |
| Bound TLS Details match a TLS fixture's certificate | 7 (recorded input), 9 (fixture server) |

## Risks

Most of these move into step 0, so they surface before step 1 freezes a shape.

1. **CDP eviction.** The comment from #180 says enabling an event domain evicts other CDP clients,
   and that broke Playwright in e2e. Step 0 question 1.
2. **Out-of-process frames and workers.** Step 0 question 4 found a cross-site iframe's requests
   missing from `wc.debugger`, and a 2026-10-17 measurement found a dedicated worker's missing too.
   Missing exchanges with no count are what ADR-0035 rules out. D17 is the design; a shared
   worker's requests and targets below a failed auto-attach stay out, stated as limits.
3. **Cross-origin redirects of the main document.** The probe's redirect stayed on one origin. Step
   0 question 4.
4. **Cached responses.** A fresh partition may never produce a cache event in a fixture. If step 0
   cannot produce one, that validation item goes to the maintainer.
5. **The TLS fixture.** The hidden window has to trust a test certificate through a test-only
   allowance a packaged build cannot turn on. Step 0 question 6.
6. **Consent Suppression cancels.** The probe did not load the filter (probe spike, What this does
   not show). Step 0 question 3.
7. **Export memory and size.** Every exported file sits in memory before the ZIP archive is
   written, and one archive stays under 4 GiB. Step 9 reports the largest record its fixtures
   produce, for the budget.
8. **A later Chromium changes what a page can observe with `Network` on.** D15's script, run in CI
   by the job the maintainer adds.
9. **The `about:blank` load is visible to the page.** It adds an entry to `history.length`. Step 0
   question 7.

## Decisions the maintainer owes

Each row is a gate from the agent briefs plan that names this plan or one of its steps. The
maintainer ruled on most of them on 2026-10-10; a row, or the part of a row, marked owed is still
open.

| Gate | Steps it blocks | Ruling, 2026-10-10, or what is owed |
| --- | --- | --- |
| Approve the capture engine spec and this plan | all but step 0 | Owed. Deferred until the maintainer reads #1803 with these rulings folded in; approval settles every step and decision no ruling covers |
| Before beta.23 (#1799, a draft pull request) is tagged, decide which schema steps land in it | 1 | Ruled: beta.23 ships as is, carrying only the schema-5 (Egress) reader; the ADR-0040 and #586 schema steps share the later release with step 1's verifier |
| Settle the `warcio` licence and approve the test-only readers | 8, and 9 and 10 through it | Ruled: both licence texts through an `append` override, the 2026-10-02 approval covering the runtime and transitive dependencies, and no upstream request now; a hand-written WARC reader plus a manual Python `warcio check`; `pdfjs-dist` 5.6.205, exact-pinned, with a Dependabot ignore for 5.7 and later |
| Choose how the probe is rerun on each Electron upgrade | 9 | Ruled as recommended: the CI test on each Electron change (D15); step 9 commits the script, and the maintainer opens the pull request that adds the CI job (ADR-0048 sign-off) |
| Tag a release carrying step 1's verifier, with notes telling Shared Case members to upgrade together | 6, 9, 10 | Owed: the tag. Steps 2 to 5, 7, and 8 do not wait for it (open question A, ruled). The ADR-0040 and #586 schema steps ship in the same release. Sequenced 2026-10-26 by the orchestrating session, pending the maintainer's confirmation: the tag also waits for step 3 (#1925) and step 4 (#1926), so no release reads schema 6 while Shared Case sync fetches neither new file or `verify.sh` checks neither |
| Tag a release carrying #1747, and rule whether update checks follow the Egress | 9, through CE-3 (#1695) | Owed: the beta.23 tag; #1799 ships as is, carrying #1747's schema-5 reader. Ruled: `electron-updater` traffic goes through the proxy and fails closed, in CE-3's scope and acceptance |
| Rule on #1694: where the app displays capture fields | Display beyond `report.html` | Ruled: #1694 closed with its verifier half merged; #1816, after CE-8, shows the Egress, the inventory, the Scroll-to-load outcome, and Bound TLS Details on a Capture, apart from the TLS Cert Chain view. Step 5 covers only `report.html` |
| Whether #1667 closes once its background half is recorded | none | Ruled: #1667 closes when step 6 records its background half; its extension half closes in favor of CE-S3 |
| File and triage each step as an issue that meets the ready-for-agent bar, and queue it | all | Owed: one issue per step, with its done-when and verification commands from this plan |
| Authorize off-slot lanes and rule on the review cap | throughput | Ruled for lanes: no unattended lane beyond dispatch's two slots and no new spend bound; larger parallel batches run only in interactive sessions the maintainer watches. The ruling does not address the review cap |

## Open questions

The maintainer ruled on each on 2026-10-10, A to F as this plan recommended. Each question keeps
the evidence behind its ruling, and the decision it names holds the detail.

**A. May steps 2 to 5, 7, and 8 merge before the release that carries step 1?** The agent briefs plan
says that release blocks CE-7 to CE-9. None of these steps writes a new field from acquisition.
Duplicate (step 3) re-anchors the fields only from a source entry that has them, and only a writer
that waits for the release can create one. **Ruled 2026-10-10:** yes. Steps 2 to 5, 7, and 8 may
merge before the release that carries step 1's verifier, so the wait for the release overlaps with
review; only the writer steps, 6, 9, and 10, wait for it.

**B. Does one Case Archive bump in step 3 replace the bump the agent briefs plan gives CE-6?** An
older importer drops the step 2 columns, but they stay null until step 6, which merges after step
3. **Ruled 2026-10-10:** yes. Step 3, the files step, carries the slice's one Case Archive bump and
must merge before any writer; CE-6 (step 2) does not bump.

**C. Does step 9 still wait for SC-2 (#1512)?** With D14, SC-2 carries and checks both files
whichever merges first. **Ruled 2026-10-10:** step 9 no longer waits for SC-2, and whichever of
SC-2 and steps 9 and 10 merges second adds the two-peer test. SC-2 waits on several gates of its
own (the agent briefs plan, gates table), so the wait would hold the slice on unrelated decisions.

**D. Accept D1 to D7 as the shape step 1 freezes?** That includes the `webSockets` count, the
Scroll-to-load outcomes without `failed`, `scrollLockLifted`, the literal `true` values D2's rule
gives `requested` and `afterCollection`, and a Duplicate that re-anchors the inventory and
Scroll-to-load but writes no Bound TLS Details (D11). It also includes two Bound TLS Details
choices:

- **The fields.** The spec asks for "the structured fields the TLS spike lists", and its
  parenthetical names eight. D7 keeps the TLS spike's list except `certificateId`, so
  `certificateTransparencyCompliance`, `serverSignatureAlgorithm`, and `encryptedClientHello` are
  in, and adds `mac`, which neither lists, because CDP splits the cipher across `cipher` and
  `mac`. The TLS spike names CT compliance as the field that shows whether the certificate was
  CT-logged. A field left out now costs a schema step to add, and a field kept cannot be removed
  from a released verifier.
- **Where the absence reason sits.** D1 puts `boundTlsAbsent` beside `boundTls`. The spec has
  "the inventory says why", and the agent briefs plan's CE-7 puts the reason in the Transaction
  Record part of the inventory. D1 gives the reason for the departure: a Duplicate re-anchors the
  inventory and has no Bound TLS Details of its own.

**Ruled 2026-10-10:** accept D1 to D7 as the shape step 1 freezes, including
`certificateTransparencyCompliance`, `serverSignatureAlgorithm`, `encryptedClientHello`, `mac`, and
the top-level `boundTlsAbsent`.

**E. When `Network.enable` does not answer, or the body fetches, the writer, or the print fail or
time out, keep the Capture or fail the Recapture?** **Ruled 2026-10-10:** keep the Capture, with
the Transaction Record or the PDF recorded absent as `failed`. MHTML and a screenshot are what a
`background` Capture holds today, and ADR-0035 lets a Capture say it has no Transaction Record
(ADR-0035, Decision).

**F. Should the orphan scan flag a Capture whose Transaction Record or PDF file is missing?** The
agent briefs plan's CE-9 says it flags one. `cleanOrphans` deletes every Capture row the scan
reports, with its Exhibit row, so a missing record would delete a Capture whose MHTML is intact.
The screenshot works that way today. **Ruled 2026-10-10:** the orphan scan reports only stray
files, and a missing Transaction Record or PDF surfaces as `missing` in verification, which
`verifySidecars` reports when the Capture is verified. This replaces the agent briefs plan's CE-9
clause "flags a Capture missing either". A separate category that `cleanOrphans` ignores would
also keep the Capture, but it changes `OrphanReport` in `src/shared/ipc.ts` and the settings
screen that lists the report (`DbUtilities.tsx`), a display change with no ruling behind it.

**G. Does the 2026-10-02 approval of `warcio` cover its eight runtime dependencies and the
transitive set the lockfile adds?** This plan made no recommendation, because the scope of that
approval is the maintainer's record. **Ruled 2026-10-10:** yes, it covers both.

### Not verified for this plan

- That enabling `Network` from `webContents.debugger` evicts Playwright's session: taken from the
  comment from #180, not reproduced (step 0 question 1).
- Whether `wc.savePage` starts network requests (step 0 question 2), how a consent cancel arrives
  (question 3), whether cross-site iframe requests and cross-origin redirect hops appear
  (question 4), whether a fresh partition produces a cache event (question 5), and whether
  `securityDetails` arrives under a test certificate (question 6). Step 0 answered each; question
  4 led to D17.
- For D17: whether a target paused for the engine also waits on Playwright's own debugger; nested
  cross-site frames; why sending the resume with a frame's other setup commands stalls the frame in
  Electron; why a fetch that delivered its data reported no `loadingFinished` in two of the six runs
  of the other two orders (the first run of each, whose fetches did not read their bodies), which
  none of the nine runs of the order per type showed, two of them with the same fetches; whether the
  order per target type holds beyond one fixture on one Linux host; and what happens when the page's
  `Target.setAutoAttach` fails or hangs, which no fixture made.
- CDP command, event, and type facts come from the `devtools-protocol` npm package 0.0.1716261, not
  from the definition Chromium 152 ships. Whether CDP's `remoteIPAddress` names the proxy through a
  SOCKS5 Egress is unmeasured.
- That `jq -cS` and `canonicalStringify` serialize a fractional number differently: the plan relies
  on the invariant the `canonicalJson.ts` header comment states, not on a run.
- Whether `warcio` 2.4.12 runs under the `ELECTRON_RUN_AS_NODE` test runner (step 8's tests
  check) and loads in the built app, where electron-vite leaves it external (step 9's e2e spec
  checks).
- Whether the renderer can remove the `about:blank` entry before the target commits, for example
  with `wc.navigationHistory.clear()` (step 0 question 7).
- What `keyExchange` holds for the TLS versions Chromium 152 negotiates with the fixture (step 0
  question 6).
- Whether `pnpm install` on the Node 20 toolchain accepts `pdfjs-dist` 5.6.205, and whether its text
  extraction works without the optional `@napi-rs/canvas`.
- The transitive licences of `warcio`'s dependencies: the lockfile decides the set, and
  `pnpm build:notices` in step 8 checks it.
- The browsertrix-crawler and archiveweb.page practice was read from their code at the named
  commits; this plan found no published statement of it.
- Python `warcio check` was not run on any output; only its PyPI description was read.
- How the export's `include.screenshots` option meets Package Verification's screenshot check.
- How the collector tells an incomplete multipart request body from a complete one: neither the
  spec nor any test settles it, and step 7 defines it.
- Whether the collector can tell an over-budget body from one the browser no longer held.

## Rulings, 2026-10-10

The maintainer ruled on each item below on 2026-10-10. Approval of this plan and the spec is not
among them: the maintainer approves both on #1803 after reading the plan with these rulings
folded in.

- **Spec open question 1, decoded bodies.** The writer keeps the original `Content-Encoding`,
  `Transfer-Encoding`, and `Content-Length` under `x-orig-` names and rewrites `Content-Length` to
  the stored body's length.
- **Spec open question 2, compression.** Birdbrain stores the Transaction Record as `.warc.gz`,
  one gzip member per record.
- **Open question A, merging before the release.** Steps 2 to 5, 7, and 8 may merge before the
  release that carries step 1's verifier; only the writer steps, 6, 9, and 10, wait for it.
- **Open question B, the Case Archive bump.** Step 3 carries the slice's one Case Archive bump and
  merges before any writer; CE-6 (step 2) does not bump.
- **Open question C, SC-2.** Step 9 no longer waits for SC-2; whichever of SC-2 and steps 9 and 10
  merges second adds the two-peer test.
- **Open question D, the shape step 1 freezes.** D1 to D7 as written, including
  `certificateTransparencyCompliance`, `serverSignatureAlgorithm`, `encryptedClientHello`, `mac`,
  and the top-level `boundTlsAbsent`. This settles spec open question 5 for this slice: the
  inventory counts WebSocket connections, frames stay out of this slice as the spec says, and
  whether they belong in the record stays a later decision.
- **Open question E, failures.** When `Network.enable`, a body fetch, the writer, or the print
  fails, the engine keeps the Capture and records the Transaction Record or the PDF absent as
  `failed`.
- **Open question F, the orphan scan.** The orphan scan reports only stray files, and
  `verifySidecars` reports a missing Transaction Record or PDF as `missing`. This replaces the
  agent briefs plan's CE-9 clause "flags a Capture missing either".
- **Open question G and the `warcio` licence.** Birdbrain takes `warcio` under both texts, through
  an `append` entry in `overrides.json` with the Apache-2.0 text. The 2026-10-02 approval covers its
  eight runtime dependencies and the lockfile's transitive set. The maintainer makes no upstream
  request now.
- **Test readers.** A hand-written WARC reader in the tests, plus a manual Python `warcio check` in
  the validation record; `pdfjs-dist` 5.6.205 as an exact-pinned devDependency, with a Dependabot
  ignore for 5.7 and later.
- **Probe rerun (D15).** A CI test on each Electron change. Step 9 commits the probe script, and the
  maintainer opens the pull request that adds the CI job (ADR-0048 sign-off).
- **beta.23.** beta.23 (#1799) ships as is, carrying only the schema-5 (Egress) reader. The
  ADR-0040 and #586 schema steps share the later release with step 1's verifier.
- **Update checks.** `electron-updater` traffic follows the Egress: it goes through the proxy and
  fails closed. CE-3 (#1695) carries this in its scope and acceptance.
- **Display (#1694).** #1694 is closed, its verifier half merged. #1816, filed to follow CE-8, shows
  the Egress, the inventory, the Scroll-to-load outcome, and Bound TLS Details on a Capture, kept
  apart from the TLS Cert Chain view.
- **#1667.** It closes when step 6 records its background half; its extension half closes in favor
  of CE-S3.
- **#598 (CE-10).** Extraction runs in a utility process, and #598 is ready-for-agent with that
  direction. Steps 6, 9, and 10 still follow CE-10 in `captureLifecycle.ts` (Lanes and hot files).
- **Parallel lanes.** No unattended lane beyond dispatch's two slots, and no new spend bound; larger
  parallel batches run only in interactive sessions the maintainer watches.
- **Stage 2 rulings that bear on D13.** The verifier learns `launched-passive` in a release before
  #600's writer merges, the glossary and reporting surfaces change with #600, and #599 is to be
  clarified (CE-S2 decision D5). A `launched` entry signs the browser product, version, and family,
  and a `launched-passive` entry records which rule took it (CE-S2 decision D12).

## Ruling, 2026-10-17

- **Requests inside a cross-site frame (#1823, step 0 question 4).** The engine attaches to each
  cross-site frame's process and records its requests, so the Transaction Record covers the whole
  page. An agent adds a short design to this plan for the maintainer's approval before step 1
  starts; that design is D17, with the two counts it adds to D4 and its reading of ruling E for a
  child session. The ruling is recorded in a comment on #1823 of the same day.

## Progress

- **2026-10-10.** Drafted from two independent drafts and checked against `origin/main` at
  `df531d36`. The probe rerun on Electron 44.5.1 is done, with no change (see that section). Step 0
  has not run. [The agent briefs plan](2026-10-10-three-programme-agent-briefs.md) sits on an
  unmerged branch, so links to it resolve once it merges.
- **2026-10-10.** Revised after a review: the probe's CI job moves to a pull request the
  maintainer opens (ADR-0048), step 0 gains a `history.length` question after a scratch run
  measured the `about:blank` entry, D7 follows the TLS spike's field list, D8 states the records
  of each partial exchange, steps 9 and 10 say where their time comes from, and open question F
  recommends one option.
- **2026-10-10.** Folded in the maintainer's rulings of the same day (Rulings, 2026-10-10): open
  questions A to G, the spec's open questions 1 and 2, the `warcio` licence and test-reader
  gate, the probe rerun, beta.23, update checks, #1694, #1667, #598, and parallel lanes. D13 now
  cites the stage 2 spec and the two stage 2 rulings that bear on it. The plan and the spec still
  await the maintainer's approval on #1803.
- **2026-10-17.** Step 0 delivered as the renderer spike (#1840). Added D17, the design for
  out-of-process frames and workers that the maintainer's ruling of the same day asks for, from a
  scratch measurement on Electron 44.7.0, and the two inventory counts it proposes. Revised after
  the pull request's review: service workers recorded, a total body cap, the counts defined,
  ruling E's reading for a child session, and the limits restated. Revised after its second
  review: the setup order set per target type from a rerun measurement, the body cap applied
  before fetching, the page's own auto-attach bounded and counted, and the departure from ADR-0035
  named for approval. Step 1 waits for its approval.
- **2026-10-26.** Step 1 (#1904) takes manifest schema 6: beta.23, the latest tag, reads 5. D4
  gains the two MHTML counts from #1843. `CAPTURE_ENTRY_HASH_FIELDS` stays at its three fields:
  the sync maps each field to a Capture Store file type (`CAPTURE_ARTIFACT_BY_FIELD` in
  `blobAcceptance.ts`), and the store has no type for either new file until step 3. Step 1
  leaves the list for step 3 to extend, a change to D2 and D14 that awaits the maintainer's ruling.
- **2026-10-26.** Release sequencing after #1978's review, decided by the orchestrating session
  and pending the maintainer's confirmation, not a maintainer ruling: the tag carrying step 1's
  verifier also waits for step 3 (#1925) and step 4 (#1926). A build that reads schema 6 accepts a
  schema-6 Capture from another member, where beta.23 stops at it and asks for an update. Until
  step 3 adds `transactionRecordHash` and `pdfHash` to `CAPTURE_ENTRY_HASH_FIELDS`, with their
  Capture Store file types, the sync fetches neither file, and until step 4 `verify.sh` checks
  neither. Holding the tag until both merge means no released build has that gap.
- **2026-10-26.** Step 3 (#1925) takes Case Archive version 13, the next after 12 on `main`. It
  adds `transactionRecordHash` and `pdfHash` to `CAPTURE_ENTRY_HASH_FIELDS`, mapped to the new
  `warc.gz` and `pdf` file types, so a Shared Case member fetches and hash-checks both files.
- **2026-10-26.** D4's Transaction Record part gains `finishedWithoutResponse`, on the
  maintainer's ruling during step 9's review (#1999) as the orchestrating session relayed it.
  Step 1 (#1904) adds it to schema 6; making the collector count it is left to step 9.
