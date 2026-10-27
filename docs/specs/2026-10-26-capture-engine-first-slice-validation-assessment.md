# Capture engine first slice: validation record

**Date:** 2026-10-26

**Status:** Open. Step 6 of the
[first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md) started this record, and
steps 9 and 10 extended it, as did #1843, which writes the MHTML counts. With them it covers
every writer of the slice, and the maintainer
records the acceptance decision before the release that ships the writers (plan, D16). The acceptance decision is this record's approval, so nothing
changes it after that.

ADR-0004 asks every evidence-affecting release for a version-specific validation record with
environments, expected and observed results, deviations, false positives and negatives, known
limitations, and the acceptance decision (ADR-0004, Validation and independent verification).
Each section below has one part per step.

## Scope

**Step 6 (#1928).** A `background` Capture's signed `capture` entry gains `scrollToLoad` (D5) and
`inventory` (D4), and its `captures` row mirrors both (D9). The inventory records MHTML and the
screenshot as present, with the screenshot facts of D6, and the Transaction Record and the PDF as
absent with the reason `not-taken`. A Duplicate re-anchors both fields from its source's signed
entry and mirrors them on its own row (D11).

**Step 9 (#1929).** A `background` Capture gains a Transaction Record, `{captureId}.warc.gz`
beside the MHTML, written from the events of every debugger session the render set up (D17,
with the charset spike's rulings of 2026-10-26). Its signed entry gains `transactionRecordHash`,
the Transaction Record part of `inventory`, and `boundTls` or `boundTlsAbsent` (D7), and its row
mirrors the three. When recording fails or runs out of time, the inventory records the record
absent as `failed`, `boundTlsAbsent` is `not-recorded`, and the Capture stores. A Duplicate
re-anchors `transactionRecordHash` and its row mirrors it, with no Bound TLS Details (D11).

**Step 10 (#1930).** A `background` Capture gains a PDF, `{captureId}.pdf` beside the MHTML,
printed with `webContents.printToPDF` after the screenshot, the MHTML, and the Transaction
Record's two end phases. Its signed entry gains `pdfHash` and the PDF part of `inventory`,
`{ present: true, afterCollection: true }`, and its row mirrors the hash. A print that fails or
runs out of time, a page taller than `MAX_PDF_CONTENT_HEIGHT_PX`, and a PDF over `MAX_PDF_SIZE`
each record the PDF absent as `failed`, and the Capture stores. A Duplicate re-anchors `pdfHash`
and its row mirrors it (D11).

**#1843.** After the screenshot and before the save, the render pins each `srcset` image to the
source it displayed (ADR-0055, D4), and the inventory's MHTML part carries the true
`pinnedImages` and `pinnedImagesNotLoaded` in place of step 6's zeros. A pin script that throws,
or returns counts the strict schema refuses, fails the render. A Duplicate re-anchors the part
with the rest of the inventory (D11).

## Environments

**Step 6.** One Linux workstation: kernel 7.2.8 (Omarchy), Node 20.20.2, Electron 44.9.1 with
Chromium 152.0.7977.167. The unit suite runs under Electron as Node, with sharp built against
the system libvips (`pnpm build:test-sharp`). The end-to-end specs run the built app under
`xvfb-run`; `e2e/recapture.spec.ts` ran inside `unshare -rn`, a network namespace with loopback
only, because a running Birdbrain held the capture server's port, and the other Recapture specs
ran outside it. Windows and macOS were not run.

**Step 9.** The same workstation, Node 20.20.2, and Electron 44.9.1 with Chromium
152.0.7977.167. The unit suite ran as in step 6. Every Recapture end-to-end spec ran against the
built app under `xvfb-run`, outside a network namespace: no process held the capture server's
port. The fixture servers are HTTP/1.1 on loopback, one of them over TLS 1.3 with a leaf from a
test authority each run makes. The probe command of D15 ran under `xvfb-run` on Node 20.20.2.
The manual `warcio check` of ruling 26 ran `warcio` 1.8.1, the separate Python implementation,
through `uvx --from 'warcio==1.8.1'`, on the records the end-to-end spec stored. The figures
below are from the head after the review of #1999, except the demo page sizes and the writer
timing, measured at `54e5fcf6`.

**Step 10.** The same workstation, Node 20.20.2, and Electron 44.9.1 with Chromium
152.0.7977.167. The unit suite ran as in step 6. The Recapture end-to-end specs ran against the
built app under `xvfb-run`, outside a network namespace: no process held the capture server's
port. pdf.js (`pdfjs-dist` 5.6.205) read the stored PDF in the spec's own process, on Node
20.20.2, with the optional `@napi-rs/canvas` 0.1.100 that pnpm installed beside it. The print
sizes and times below come from a standalone Electron 44.9.1 script outside the repository, one
process per page, in an offscreen sandboxed window on a fresh partition under `xvfb-run`, which
called `printToPDF({})`, the render's options, 1.5 s after each load.

**#1843.** The same workstation, Node 20.20.2, and Electron 44.9.1 with Chromium
152.0.7977.167. The unit suite ran as in step 6, and the Recapture end-to-end specs against the
built app under `xvfb-run`, outside a network namespace. The browser behaviour listed under the
table comes from a standalone Electron 44.9.1 script outside the repository: an offscreen
sandboxed window on a fresh partition loads a fixture page from loopback, waits 2.5 s, runs the
render's pin script, and calls `savePage(path, 'MHTML')`. Each image response is a PNG followed
by `TAG:<request path>`, and the server logs each request with the phase it arrived in.

## Expected and observed results

**Step 6.**

| Check                                                                                                                                                                | Expected                                                                                                                                                                                                                                                                                                   | Observed                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each D5 ending, driven with a mocked `WebContents` (`tests/main/services/backgroundRenderer.test.ts`, `scrollToLoadLazyContent`)                                     | Budget zero records `ran: false` and no outcome; no scrollable root records `nothing-to-scroll`; a page at the scroll cap records `height-cap`; three steps without a change in height record `stopped-growing`; the phase deadline records `time-budget`                                                  | Each as expected, and each record passes the strict schema                                                                                                                 |
| The stall count (same file)                                                                                                                                          | A page that grows before the third stall step keeps scrolling; a step that moves on to a second pane, at a different height, restarts the count                                                                                                                                                            | As expected                                                                                                                                                                |
| The root each step scrolls, with the step script run against a simulated page (same file, the step script's tests)                                                   | The document first; once it cannot move down, the inner panel with the most overflow that can; once nothing can move down, the root at its end with the most overflow, reported rather than `null`; `null` only when nothing overflows                                                                     | As expected for a document at its end, an app-shell page whose document overflows by its 16px margin, a page with two panes, and a panel that grows after reaching its end |
| A step that throws (same file)                                                                                                                                       | The phase rejects, so the render fails, and the page's scroll position and lock are restored                                                                                                                                                                                                               | As expected                                                                                                                                                                |
| A restore that fails (same file)                                                                                                                                     | With a lifted scroll lock, the phase rejects, so the render fails; a step's own error wins over the restore's; with no lock lifted, the failure is logged and the phase recorded                                                                                                                           | As expected                                                                                                                                                                |
| A height the page reports that is not a non-negative integer (same file)                                                                                             | No `endHeight`                                                                                                                                                                                                                                                                                             | As expected for a fraction, a negative number, and text                                                                                                                    |
| The D6 facts (same file, `captureFullPageScreenshot` and `trimTrailingBackground`)                                                                                   | Scaled, truncated, trimmed, and none each recorded, with the stored PNG's dimensions; content ending within the 8px padding of the bottom edge records `trimmed: false`, and one row higher crops; a failed trim keeps the image and records `trimmed: false`; an image that is not a PNG fails the render | As expected                                                                                                                                                                |
| The signed entry of a Recapture, and of its Duplicate (`tests/main/services/recapture.test.ts`)                                                                      | Both pass the strict manifest schema, stamped 6; both rows mirror the entry                                                                                                                                                                                                                                | As expected                                                                                                                                                                |
| An end-to-end Recapture of an invented page that grows from 1601 to 4001 CSS pixels as it is scrolled (`e2e/recapture.spec.ts`)                                      | `stopped-growing`, `endHeight` 4001, `scrollLockLifted` false; screenshot not scaled, not truncated, not trimmed, `contentHeight` 4001, `width` and `height` equal to the stored PNG's; row equal to entry; the Capture verifies                                                                           | As expected, after the first deviation below was fixed                                                                                                                     |
| An end-to-end Recapture of an app-shell page: the document overflows by its 16px margin and an inner panel grows from 2001 to 10001 px as it is scrolled (same file) | `stopped-growing`, `endHeight` 10001, and the panel's last lazy chunk in the stored text                                                                                                                                                                                                                   | As expected, after the second deviation below was fixed                                                                                                                    |
| An end-to-end Recapture of a page with two scrolling panes, a 2001 px pane growing to 3001 and a 4001 px pane growing to 6001 (same file)                            | `stopped-growing`, `endHeight` 6001, and both panes' lazy chunks in the stored text                                                                                                                                                                                                                        | As expected                                                                                                                                                                |

**Step 9.**

| Check                                                                                                                                                                                     | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Observed                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The page session's setup (`tests/main/services/transactionRecorder.test.ts`)                                                                                                              | `Network.enable`, `Network.configureDurableMessages`, then `Target.setAutoAttach`, each with the budget; an `enable` that fails or does not answer records nothing and resumes any target that attaches                                                                                                                                                                                                                                                                                                                                                                                                                                 | As expected                                                                                                                                                                                                                             |
| Each attached target's setup (same file)                                                                                                                                                  | A frame or a dedicated worker gets three commands together and is resumed once, after they answer or the 2 s bound runs out; a service worker is resumed with them; any other type is resumed at once and counted unrecorded; a target that attaches after collection stops is resumed and not counted                                                                                                                                                                                                                                                                                                                                  | As expected                                                                                                                                                                                                                             |
| The body budget (same file)                                                                                                                                                               | No fetch of a response body whose reported length is over the per-resource limit, or whose four-thirds estimate would take the held total past the cap; a returned body over either limit is not kept, and one that fills the cap exactly is; the returned length replaces the estimate; a body is handed to the collector from the session that finished the request last                                                                                                                                                                                                                                                              | As expected, with the limits scaled down for the test                                                                                                                                                                                   |
| Request bodies under the budget (same file)                                                                                                                                               | A request body is reserved before `Network.getRequestPostData` is sent: four thirds of a declared length, what the event carries, or four thirds of the per-resource limit; nothing is sent past the cap or for a declared length over the limit; returned post data that fills the cap exactly is kept and none past it; a failed fetch leaves the body incomplete                                                                                                                                                                                                                                                                     | As expected                                                                                                                                                                                                                             |
| The event budget (same file)                                                                                                                                                              | Past 25,000 held events, or 25,000,000 bytes of their JSON, the recorder lets everything go, fetches nothing more, resumes any later target, and the record is `failed`; exactly the bound is held; `Network.dataReceived` is never held                                                                                                                                                                                                                                                                                                                                                                                                | As expected, with the bounds scaled down for the test                                                                                                                                                                                   |
| Text bodies (`src/packages/transaction-record/tests`)                                                                                                                                     | A text body is kept only from a session whose durable messages answered, judged by the session that reported `loadingFinished`, and only when it was fetched on that session; a base64 body from any session; the writer stores the served windows-1252 bytes, payload digest `sha256:f92b1f90c50a0068a6c9dfce9c853e9333a8337b6475fab8a4393f1b1fccd319`; no record carries `x-birdbrain-decoded-text`                                                                                                                                                                                                                                   | As expected                                                                                                                                                                                                                             |
| A request that finished with no response (same tests)                                                                                                                                     | Counted in `finishedWithoutResponse`, in neither `inFlight` nor `exchanges`, and written as a request record only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | As expected                                                                                                                                                                                                                             |
| The strict schema (`tests/main/services/transactionRecorder.test.ts`)                                                                                                                     | A main document whose SCT timestamp falls after the year 9999, which `toISOString` writes with a six-digit year, records the Transaction Record `failed` instead of reaching the signed entry                                                                                                                                                                                                                                                                                                                                                                                                                                           | As expected                                                                                                                                                                                                                             |
| The render (`tests/main/services/backgroundRenderer.test.ts`)                                                                                                                             | `about:blank`, the page setup, then the target; collection stops before the screenshot; a failed `enable`, a body fetch that never settles, and a writer that throws each return the record as `failed`; no certificate allowance without the switch or in a packaged build                                                                                                                                                                                                                                                                                                                                                             | As expected                                                                                                                                                                                                                             |
| The end reserve and the cut (same file)                                                                                                                                                   | No Scroll-to-load budget under a 34 s timeout, some under 37.5 s, so the reserve is 35 s; with a 3 s timeout, a body fetch or a writer that never settles is cut to the time left less the 1 s margin and the render returns its page with the record `failed`                                                                                                                                                                                                                                                                                                                                                                          | As expected; each cut ended between 1,000 and 2,000 ms                                                                                                                                                                                  |
| The notice that the record failed (`tests/main/services/recapture.test.ts`)                                                                                                               | Logged once the Capture is stored, with the error; not logged when the job then refuses the final URL or the ingest fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | As expected                                                                                                                                                                                                                             |
| Ingest and the Duplicate (`tests/main/services/recapture.test.ts`, `captureLifecycle.test.ts`)                                                                                            | The entry passes the strict schema with the record's hash, inventory part, and `boundTls` or `boundTlsAbsent`; the file is stored under the id the render was given; the row mirrors the entry; a changed byte reads `tampered`; a failed record writes no file and `not-recorded`; a Duplicate's entry and row carry the hash and no Bound TLS Details                                                                                                                                                                                                                                                                                 | As expected                                                                                                                                                                                                                             |
| Two peers over the in-process transport (`tests/main/services/sharing/syncPeers.test.ts`)                                                                                                 | A record altered in transit is refused as `hash-mismatch` and not written; the next session takes the genuine bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | As expected                                                                                                                                                                                                                             |
| An end-to-end Recapture of a fixture page with a cross-site frame, a dedicated worker in the page and one in the frame, and a service worker (`e2e/recapture-transaction-record.spec.ts`) | One request record for each request the servers logged, plus the cached second use, the page's copy of the response its service worker answered, and the request the consent filter blocked; `cached` 1, `cancelled` 1, `failed` 2, `inFlight` 1, `finishedWithoutResponse` 1, `recordedTargets` 5, `unrecordedTargets` 0; `exchanges` and `bodiesOmitted` equal to the response records and the truncated ones                                                                                                                                                                                                                         | As expected                                                                                                                                                                                                                             |
| Known answers in the same record                                                                                                                                                          | Payload digests equal the SHA-256 of the served bodies for a `gzip` body, a plain one, windows-1252, Shift_JIS, UTF-8 with a byte-order mark, and UTF-8 under a windows-1252 label; posted windows-1252 (`636166e9`), Shift_JIS (`93fa967b`) and UTF-8 bodies are stored as the bytes sent; both redirect hops, same-origin and cross-origin, have a `302` response with no body; the over-limit body and the page's copy of the service worker's answer are `WARC-Truncated`; the cookie the page set and sent appears nowhere in the inflated record; `WARC-IP-Address` 127.0.0.1; `boundTlsAbsent` `not-https`; the Capture verifies | As expected                                                                                                                                                                                                                             |
| A page that fetches in a loop for as long as it is open (same file)                                                                                                                       | The Capture is stored and verifies, with the record absent as `failed`, `boundTlsAbsent` `not-recorded`, and no record file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | As expected; the server logged more than 8,000 of its requests                                                                                                                                                                          |
| Stubbed setup failures (same file)                                                                                                                                                        | A frame's failed `Network.enable` moves `unrecordedTargets`; the page's failed `Target.setAutoAttach` makes the page unrecorded; both keep the record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | As expected: 2 unrecorded for the frame and the worker it starts, 1 for the page                                                                                                                                                        |
| A page over TLS through the test certificate allowance (same file)                                                                                                                        | `boundTls` states the leaf's subject, alternative names, issuer, and validity; without the allowance the Recapture fails with `ERR_CERT_AUTHORITY_INVALID`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | As expected                                                                                                                                                                                                                             |
| A proxy Egress through the SOCKS5 fixture (same file)                                                                                                                                     | No `WARC-IP-Address`, and neither the record nor the inventory names the proxy's port; the proxy shares the target's host, 127.0.0.1, so this does not show the host left out                                                                                                                                                                                                                                                                                                                                                                                                                                                           | As expected                                                                                                                                                                                                                             |
| The other Recapture specs (`e2e/recapture.spec.ts`, `recapture-consent.spec.ts`, `recapture-egress.spec.ts`, `recapture-permissions.spec.ts`, `recapture-local-redirect.spec.ts`)         | Pass with the Network domain on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | All passed, in one run with the new spec: 18 of 18                                                                                                                                                                                      |
| `warcio check` (`warcio` 1.8.1) on the five records that run stored                                                                                                                       | Exit 0, every digest it checks passing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Exit 0 on each, with no output; verbose, the fixture page's 61 records (one `warcinfo`, 33 requests, 27 responses) gave 60 `digest pass` and one `no digest to check` for the `warcinfo`, and the four smaller records the same pattern |
| D15's probe, `xvfb-run --auto-servernum node scripts/capture-probe/run.mjs`                                                                                                               | The on pass sends `Network.enable`, `Network.configureDurableMessages`, and `Target.setAutoAttach`; the passes agree on `navigator.webdriver`, the `window.chrome` keys, the `Error.stack` getter count, and the resource timing list; `history.length` 1 off and 2 on                                                                                                                                                                                                                                                                                                                                                                  | As expected, exit 0                                                                                                                                                                                                                     |
| Record sizes (plan, open question 3)                                                                                                                                                      | Reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 37,168 bytes for the fixture page above, the largest; 1,879 to 2,643 bytes for the stub, TLS, and proxy pages; 3,248 to 3,385 bytes for each of the three demo fixture pages (`scripts/demo-fixture/pages/`)                            |
| The writer at the 50,000,000-byte cap                                                                                                                                                     | Inside its 10 s bound                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Five 7,500,000-byte bodies held as base64: 1,397 ms for random bytes, 37,515,985 bytes written; 410 ms for one repeated byte                                                                                                            |

**Step 10.**

| Check                                                                                                                                                                                                                       | Expected                                                                                                                                                                                                                                                                                                                                                                                                                  | Observed                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The print's order and options (`tests/main/services/backgroundRenderer.test.ts`)                                                                                                                                            | `printToPDF` called once, with `{}`, after the screenshot, `savePage`, and the Transaction Record writer                                                                                                                                                                                                                                                                                                                  | As expected                                                                                                                                                                                                       |
| A request the page starts while it prints (same file)                                                                                                                                                                       | Not in the Transaction Record, which holds the one exchange made before collection stopped                                                                                                                                                                                                                                                                                                                                | As expected                                                                                                                                                                                                       |
| The print's bound and the cut (same file)                                                                                                                                                                                   | Under a 30 s timeout, a print that never settles records the PDF `failed` at its 5,000 ms bound; under a 3 s timeout it is cut to the time left less the 1 s margin; when the record phases have used the time left, the print does not start; a print that throws records `failed`; the render returns its page each time                                                                                                | As expected; the cut print ended inside the 1,000 to 2,000 ms the test allows                                                                                                                                     |
| The end reserve (same file)                                                                                                                                                                                                 | No Scroll-to-load budget under a 39 s timeout, some under 42.5 s, so the reserve is 40 s                                                                                                                                                                                                                                                                                                                                  | As expected                                                                                                                                                                                                       |
| The size bounds (same file)                                                                                                                                                                                                 | A page whose content height is 50,001 CSS pixels is not printed and one at 50,000 is; a PDF of 104,857,601 bytes is discarded and one of 104,857,600 bytes kept; each refusal records `failed` with an error that names its constant                                                                                                                                                                                      | As expected                                                                                                                                                                                                       |
| The render handed to the Recapture queue and ingest (same file)                                                                                                                                                             | A printed PDF is stored as `{captureId}.pdf`, its hash signed and mirrored, the entry passing the strict schema, and a changed byte reads `tampered`; a print that never settles, a page over the layout bound, and a PDF over `MAX_PDF_SIZE` each store a Capture that verifies, with the PDF absent as `failed`, no `.pdf` file, no hash, and one `backgroundRenderer.pdf_failed` log entry whose error names the bound | As expected; the case that never settles stored inside 5.2 s of its 30 s timeout                                                                                                                                  |
| Ingest, the notice, and the Duplicate (`recapture.test.ts`, `captureLifecycle.test.ts`, `captureDuplicate.test.ts`)                                                                                                         | The notice is logged once the Capture is stored, and not for a printed PDF or a failed ingest; ingest with no PDF writes no file; a Duplicate's entry re-anchors `pdfHash`, and its row mirrors it and `transactionRecordHash`                                                                                                                                                                                            | As expected                                                                                                                                                                                                       |
| Two peers over the in-process transport (`tests/main/services/sharing/syncPeers.test.ts`)                                                                                                                                   | A PDF altered in transit is refused as `hash-mismatch` and not written; the next session takes the genuine bytes                                                                                                                                                                                                                                                                                                          | As expected                                                                                                                                                                                                       |
| Both shipped verifiers (`tests/main/services/verifyRunbookExecution.test.ts`)                                                                                                                                               | A package exported from a Capture whose PDF the ingest stored passes Package Verification and `verify.sh`, which reports `0 Transaction Record(s) and 1 PDF(s) bound to the signed chain`; a changed byte in the packaged PDF fails both, `verify.sh` at step 5                                                                                                                                                           | As expected                                                                                                                                                                                                       |
| An end-to-end Recapture of the probe's print-only image fixture (`e2e/recapture-transaction-record.spec.ts`)                                                                                                                | The server logs `/print-only.png` and no request record names it; the stored PDF hashes to `pdfHash`; pdf.js reads one Letter page, 612 by 792 points, holding the fixture's text; the Capture verifies; a package exported from it passes Package Verification, and a changed PDF byte fails its `pdf` check                                                                                                             | As expected                                                                                                                                                                                                       |
| The same case with the print moved before collection stops (a local edit, reverted)                                                                                                                                         | The case fails                                                                                                                                                                                                                                                                                                                                                                                                            | Failed on the record's request list, which held `/print` and `/print-only.png`                                                                                                                                    |
| Every Recapture end-to-end spec (`recapture-transaction-record.spec.ts`, `recapture.spec.ts`, `recapture-consent.spec.ts`, `recapture-egress.spec.ts`, `recapture-permissions.spec.ts`, `recapture-local-redirect.spec.ts`) | Pass with the print added                                                                                                                                                                                                                                                                                                                                                                                                 | 19 of 19 in one run, after step 6's case in `recapture.spec.ts`, which expected the PDF `not-taken`, was changed to expect the printed part and the mirrored hash                                                 |
| PDF sizes (plan, step 10, the size bounds)                                                                                                                                                                                  | Reported                                                                                                                                                                                                                                                                                                                                                                                                                  | 5,578 to 19,616 bytes for the six PDFs the end-to-end spec stored, the fixture page with a frame and workers the largest; 41,003 to 56,925 bytes for the three demo fixture pages (`scripts/demo-fixture/pages/`) |

Print size and time against page height, from the standalone script. The text pages hold one
100-pixel paragraph of invented text per 100 pixels. The image pages hold one 600 by 400 pixel
PNG of random pixels per 400 pixels, so their images do not compress.

| Page   | Content height (CSS px) | Pages | Bytes      | Print time        |
| ------ | ----------------------- | ----- | ---------- | ----------------- |
| Text   | 1,000                   | 2     | 11,372     | 16 ms             |
| Text   | 25,000                  | 26    | 38,743     | 54 ms             |
| Text   | 50,000                  | 52    | 67,825     | 108 to 111 ms     |
| Text   | 100,000                 | 103   | 125,629    | 219 ms            |
| Text   | 400,000                 | 411   | 473,558    | 1,045 ms          |
| Images | 4,000                   | 5     | 7,207,461  | 172 ms            |
| Images | 25,200                  | 32    | 45,402,796 | 978 ms            |
| Images | 50,000                  | 63    | 90,084,033 | 1,905 to 1,915 ms |

The values follow from these. `MAX_PDF_CONTENT_HEIGHT_PX` is 50,000, twice the height at which
Scroll-to-load stops (`MAX_SCROLL_CONTENT_HEIGHT_PX`, 25,000): at that height the image page's
PDF, 90,084,033 bytes, stays under `MAX_PDF_SIZE`, so a page as dense as the fixture is not
printed only to be discarded. `MAX_PDF_SIZE` is 104,857,600 bytes, the screenshot's bound
(`MAX_SCREENSHOT_SIZE`). The print's own bound, 5 s, is 2.6 times the slowest print measured at
the layout bound.

**#1843.**

| Check                                                                              | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Observed                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| The pin script over fake images (`tests/main/services/backgroundRenderer.test.ts`) | Over the triage's five images and a `srcset` image with no `currentSrc`, the three `srcset` images outside a `picture` get their `currentSrc` as `src` and lose `srcset` and `sizes`, the rest are untouched, and the counts are 3 and 0; a page with no `srcset` image counts 0 and 0; an image that never loads counts as not loaded after the whole wait, and so does one whose load fails; the script stops waiting once every image has loaded, and does not wait with no time                                                                                                                                      | As expected                                          |
| The schema check on the counts (same file)                                         | A not-loaded count above the pinned count, a fraction, a negative, a missing count, and no object each reject, as does a script that throws                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | As expected                                          |
| The pin in the render (same file)                                                  | Called once, after `Page.captureScreenshot` and before `savePage`; no wait under a 39 s timeout and 5,000 ms under 60 s; under a 3 s timeout an image that never loads is counted and the render returns inside 3 s; a script that throws, or contradictory counts, fail the render with no `savePage` and the window destroyed                                                                                                                                                                                                                                                                                          | As expected                                          |
| The render handed to the Recapture queue and ingest (same file)                    | The entry's MHTML part signs 3 pinned and 1 not loaded and passes the strict schema, the row mirrors the inventory, the Capture verifies, and a Duplicate's entry and row carry the same part; a pin that throws emits `failed` and stores no Capture                                                                                                                                                                                                                                                                                                                                                                    | As expected                                          |
| Ingest and the Duplicate (`recapture.test.ts`)                                     | The part the render returns is signed, mirrored, and re-anchored by a Duplicate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | As expected                                          |
| End-to-end Recaptures (`e2e/recapture-image-sources.spec.ts`)                      | The renderer spike's `q2-savepage` fixture: a part at `/savepage/srcset-1x.png` whose bytes carry that path's tag, no request for `/savepage/srcset-2x.png`, and counts 1 and 0. The triage's five images: a part for each displayed source holding that source's bytes, no part at an address the server never served (`/five/src-fallback.png` was not requested), counts 3 and 0, a Duplicate re-anchoring them, and an exported package passing Package Verification and `verify.sh`. A `srcset` image answered with a 404: counts 1 and 1, two requests for it in the server log, and one in the Transaction Record | As expected                                          |
| The `q2-savepage` case with the rewrite disabled (a local edit, reverted)          | The case fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Failed: the MHTML had no part for the `srcset` image |
| Every Recapture end-to-end spec                                                    | Pass with the pinning added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 22 of 22 in one run                                  |

What the standalone script showed, with a 2,000 ms wait unless stated:

- No request reached the server during the pin for an image that had loaded, a `no-store` one
  included. Each was `complete` with a natural width straight after its `src` was set, and the
  MHTML held a part at its address, under a saved `img` naming that address.
- A `srcset` image answered with a 404, or with a 200 that is not an image, has a `currentSrc`
  and a natural width of 0. Pinning it sent a second request for it during the pin, and with a
  300 ms wait it counted as not loaded.
- A `srcset` image still loading had an empty `currentSrc`, so it was left as it was and not
  counted, and the MHTML had no part for it.
- An image in an open or a closed shadow root, and one in a same-origin frame, were not pinned
  and had no part; the saver wrote each as an `img` with no source.
- An image with no `width` or `height` attribute, offered at `2x` density or as `8w` with
  `sizes="2px"`, rendered at 2 by 2 and 1 by 1 CSS pixels before the pin and at 4 by 4 after it.
- An SVG with a `viewBox` and no width or height reported a natural width of 150 and counted as
  loaded.

## Deviations

**Step 6.**

- The first end-to-end run recorded `nothing-to-scroll` for the invented page, with `endHeight`
  4001: the phase had scrolled the whole page. The step script tested a root by moving it one
  pixel down, which a root at its end cannot do, so at the bottom of every page the step found no
  root and the loop ended there, before the stall detector (`SCROLL_STALL_THRESHOLD`) could. The
  first fix, at `bdb25c96`, made the test also try one pixel up.
- Review of that fix found that it kept the document chosen once the document reached its end,
  so the phase never moved on to an inner panel. On an app-shell page whose document overflows
  by its margin, the phase ended `stopped-growing` with `endHeight` 495 and loaded none of the
  panel's lazy content; on a page with two panes, it scrolled only the larger. The fix in this
  step chooses a root by the down-only test, as before step 6, and only when no root can move
  down does the step report the root at its end with the most overflow. The stall count also
  restarts when the height changes in either direction, so a step that moves on to a second pane
  does not inherit the first pane's stalls.

The effect on acquisition, against the build before step 6 (`b4bd9b71`). Each row is one
Electron run of the step script, extracted from the source named, driven through the renderer's
stall logic with a 30 s limit, in a hidden offscreen window under `xvfb-run`. The runs used
the review's reproduction script, adapted; it is not in the repository.

| Page                                                                    | Before step 6                                        | First fix (`bdb25c96`)                           | This step                                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| App shell: 16px document overflow, inner panel growing to 10001 px      | `nothing-to-scroll` at 10001, 26 steps, 4 chunks     | `stopped-growing` at 495, 4 steps, no chunk      | `stopped-growing` at 10001, 27 steps, 4 chunks     |
| Two panes of 3000 and 6000 px                                           | `nothing-to-scroll` at 3000, 19 steps, both scrolled | `stopped-growing` at 6000, 14 steps, larger only | `stopped-growing` at 6000, 22 steps, both scrolled |
| Two panes, each loading one chunk at its end                            | `nothing-to-scroll` at 3001, 21 steps, both scrolled | `stopped-growing` at 6001, 15 steps, larger only | `stopped-growing` at 6001, 24 steps, both scrolled |
| An endless document feed adding a 2000 px chunk 1 s after its end shows | `nothing-to-scroll` at 2001, 5 steps, no chunk       | `time-budget` at 22001, 60 steps, 10 chunks      | `time-budget` at 22001, 60 steps, 10 chunks        |

So on the first three pages a background render takes one to three more half-second steps
before it ends the phase. A feed whose next chunk takes longer than the half-second pause, but
arrives before the third stall step, keeps loading: where the build before step 6 stopped at the
first bottom, it now runs to the height cap or the phase's time limit.

**Step 9.**

- The first end-to-end run of the fixture page stored the Capture with the record absent as
  `failed`. The service worker's own session reported its main script with
  `Network.requestWillBeSent`, `Network.dataReceived`, and `Network.loadingFinished`, and no
  `Network.responseReceived`. The collector took the request as finished, so the writer met an
  exchange it had to write a response for and had none, and threw. The first fix counted such a
  request in `inFlight`, which widened D4's definition. The maintainer ruled on 2026-10-26 that
  it gets its own count; schema 6 gained `finishedWithoutResponse` (#1978), and this build
  writes the request record alone and counts it there.
- In the same run, the fixture service worker's install handler fetched a file without reading
  its body; that exchange reported its response and data and no `loadingFinished`. Every fixture
  fetch now reads its body, so the counts above do not depend on it.
- The review of #1999 found that the recorder held every Network event a page caused, with no
  bound until the screenshot; its measurement had a looping page make about 88,000 in ten
  seconds. It also found that request bodies were checked against the cap only after they
  arrived; in its measurement twenty 9 MB uploads pulled 180 MB into the main process for 45 MB
  kept. The recorder now holds only the events the
  collector reads, under a count and a byte bound past which the record is `failed`, and reserves
  each request body before fetching it (Expected and observed results).
- The same review found that a failed record was announced as a stored Capture before the job
  stored it, that no test pinned the 35 s reserve, and that the two end phases could carry a
  render past its deadline. The notice now follows the stored Capture, and each phase is cut to
  the time left (ruled 2026-10-26).

**Step 10.**

- The end reserve grows from 35 s to 40 s by the print's 5 s bound, as the plan's step 10 has
  it. The ruling of 2026-10-26 kept the reserve at 35 s for step 9's two record phases; the
  print takes its time by the same rule, cut to what the render has left.
- The plan records pdf.js as having no required dependencies and leaves unverified whether its
  text extraction works without the optional `@napi-rs/canvas`. It does not: with no
  `@napi-rs/canvas` to load, the 5.6.205 legacy build stops at import on Node 20.20.2 with
  `ReferenceError: DOMMatrix is not defined`. pnpm installs the optional package by default, and
  with it the same build read the stored PDFs. The package is a development dependency only, and
  no build ships it.

**#1843.**

- The triage brief asks for a separate report row, `Image sources: N pinned to the displayed
image`, absent when N is 0. Step 5 (#1985) already states both counts from the signed entry in
  the report's artifact inventory, so this change adds no second row.
- The brief pins every `srcset` image with a `currentSrc`, which ADR-0055 words as an image that
  displayed one. The two differ for an image whose load failed, which has a `currentSrc` and
  displayed nothing. The render follows the brief, so such an image is pinned, requested again,
  and counted as not loaded.

## False positives and negatives

**Step 6.**

- `stopped-growing` means three steps, half a second apart, without a change in height or
  progress. A page whose lazy content arrives after that window reads as stopped while more
  content would come.
- With every root at its end, the step reports the one with the most overflow, so a smaller pane
  that grows after the phase moved on is scrolled again only if its growth lets it move down
  before the stall count ends.
- `nothing-to-scroll` is also recorded when a page removes its scrollable root partway through
  the phase, with the last height the loop read.
- The step script runs in the page's own JavaScript world, so a page can report any position and
  height, and the outcome records what the page reported. A height that is not a non-negative
  integer is left out of the entry rather than signed.

**Step 9.**

- `finishedWithoutResponse` holds a request record and no response for a request the server
  answered in full, such as a service worker's main script on its own session, so that script's
  code is not in the record while the worker's own fetches are.
- A page that makes more requests than the event bound holds, such as one fetching in a loop,
  gets no Transaction Record at all, though most of its requests could have been recorded.
- `bodiesOmitted` is one count for a body over the per-resource limit, one the cap left
  unfetched, one the browser no longer held, a text body from a session whose durable messages
  did not answer, and the page's copy of a response its service worker answered.
- `failed` counts a request the consent filter blocked, which arrives with `canceled` false.
- A frame or worker whose setup answered after the 2 s bound counts unrecorded although its
  requests may still be recorded, and its text bodies are left out, since durable messages count
  only when they answered within the bound.

**Step 10.**

- `failed` on the PDF part covers a print that failed, one that ran out of time, and one refused
  by a size bound. The signed entry does not say which; the `backgroundRenderer.pdf_failed` log
  entry's error names the bound.
- The layout bound reads the content height the screenshot record states (D6), the document's
  content box, so it does not see the height of a panel that scrolls inside the page.

**#1843.**

- `pinnedImagesNotLoaded` is read at the check that ends the wait, just before `savePage`. An
  image that finishes between the two is still counted, so the count can overstate what was
  missing at the save, never understate it.
- The pin script runs in the page's world, so a page that interferes with it can make the counts
  wrong; the strict schema refuses only counts that are not whole numbers or that contradict
  each other.

## Known limitations

**Step 6.**

- `endHeight` is the height of the root the step scrolled. On a page that scrolls an inner
  container, that is the container's height, not the document's.
- When the browser reports no CSS content size, the screenshot is taken of the 1280 by 900
  viewport, and `contentWidth` and `contentHeight` record that box, which D6 defines as the box
  the screenshot was asked for.
- The MHTML counts `pinnedImages` and `pinnedImagesNotLoaded` are 0 on every entry this build
  writes, because the render pins no image before the save. #1843 adds the pinning. A page whose
  `srcset` images the MHTML drops still records 0, and once #1843 ships the same zeros mean that
  pinning ran and found nothing; only the entry's `toolVersion` tells the two apart. Step 6 should
  not ship in a release without #1843.
- Until steps 9 and 10, every inventory records the Transaction Record and the PDF as
  `not-taken`. That is true of the build that writes it, and it stays in the chain. From step 9,
  only the PDF is `not-taken`.

**Step 9.**

- The page reads one more `history.length` entry than a direct load gives it, because the render
  loads `about:blank` before the target. The maintainer ruled on 2026-10-26 to keep this and
  record it as a known limitation (the second decision on #1823). A page that branches on its
  history length can render differently, and nothing in the signed entry beyond `toolVersion`
  tells a Capture from this build apart from an earlier one in this respect.
- The record holds nothing of a resource reused inside the page, of a shared worker's own
  requests, or of what runs below a target whose `Target.setAutoAttach` failed (D17).
- The values of the four credential headers are replaced; a token in a URL, a body, or any other
  header stays in the record (ADR-0036).
- Request bodies were measured in three character sets only: windows-1252 and Shift_JIS bodies
  were stored as the bytes sent, and so was a UTF-8 body. A request body the browser returns as
  text is stored as its UTF-8 encoding.
- The end reserve grew from 20 s to 35 s for the two new phases (ruled 2026-10-26), so within the
  120 s Recapture timeout the load, the idle waits, and Scroll-to-load share 85 s, where they had
  100 s, less the page setup, which can take 15 s when its three commands do not answer. A slow
  page can reach the Scroll-to-load time limit up to 15 s sooner and hold less lazy content.
- The event bound, 25,000 events or 25,000,000 bytes of their JSON, is not signed and was chosen
  without a survey of real pages; only the looping fixture was run against it.
- Every fixture is HTTP/1.1 on loopback; no HTTP/2, HTTP/3, or remote server was recorded.

**Step 10.**

- The PDF is the page as Chromium prints it, with the page's print styles on Letter pages, with
  Electron's default options. What it shows can differ from the screenshot and the MHTML. A
  resource the page fetches only for printing is not in the Transaction Record; the inventory's
  `afterCollection` states that the print came after collection stopped.
- With the print's 5 s, the end reserve is 40 s, so within the 120 s Recapture timeout the load,
  the idle waits, and Scroll-to-load share 80 s, where step 9 left them 85 s. A slow page can
  reach the Scroll-to-load time limit up to 5 s sooner than under step 9 and hold less lazy
  content.
- The size bounds and the print bound were chosen from invented fixtures on one Linux
  workstation. A page whose images are larger than the fixture's reaches `MAX_PDF_SIZE` at a
  lower height, and a slower machine can reach the 5 s bound on a long page; either records the
  PDF `failed`.
- `printToPDF` hands the whole PDF to the main process before its size can be read, so a PDF over
  `MAX_PDF_SIZE` is held in memory once before it is discarded.
- pdf.js, the test reader, needs the optional `@napi-rs/canvas` to load on Node 20 (Deviations).

**#1843.**

- Pinning reaches only the `img` elements of the page's own document. An image in a frame or a
  shadow root keeps its `srcset`, and the MHTML still lacks one offered only through it.
- An image still loading when the pin runs has no `currentSrc`, so it is neither pinned nor
  counted, and the MHTML lacks it if it was offered only through `srcset`.
- Where an image's `srcset` density or `sizes` set its size and the element has no `width` and
  `height`, the saved page shows it at its natural size. The screenshot, taken before the pin,
  shows the size the page displayed.
- Pinning an image whose load had failed makes the browser request it again after collection
  stopped, so the Transaction Record lacks that request.
- The wait takes at most 5 s of the time left before the 40 s end reserve and nothing from the
  reserve. A page whose earlier phases used that time gets no wait, and an image that needed a
  new request then counts as not loaded.
- A build with step 6 and without #1843 signs zeros that read the same as a pinning pass that
  found nothing. The maintainer ruled on 2026-10-26 that no release carries step 6 without
  #1843.

## Acceptance decision

Owed: the maintainer records it here before the release that ships the writers.
