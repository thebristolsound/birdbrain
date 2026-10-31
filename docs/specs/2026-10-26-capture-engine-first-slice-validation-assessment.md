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
runs out of time, a page taller than `MAX_PDF_CONTENT_HEIGHT_PX`, a PDF over `MAX_PDF_SIZE`, and
a page that navigated after the save each record the PDF absent as `failed`, and the Capture
stores. The Capture's URL, title, and HTTP status are those of the page the save took. A
Duplicate re-anchors `pdfHash` and its row mirrors it (D11). On the background ingest path, the
whole capture entry is parsed with the strict schema before it is signed.

**Rulings for step 10, 2026-10-26.** The maintainer ruled that the end reserve rises to 40 s for
the print, leaving 80 s for the load and Scroll-to-load; that the development-only packages pdf.js
pulls in (`@napi-rs/canvas` 0.1.100, its platform packages, and a stream helper) are accepted;
and that GHSA-hq66-cqwq-w95j on the development-only `pdfjs-dist` 5.6.205 gets an audit exception
until 2026-12-31, because its fixed version needs Node 22.13 (`audit-exceptions.json`). The
programme's run log records the three, as the orchestrating session relayed them.

**#1843.** Before the screenshot and the save, the render lets images offered as sets settle,
and pins each `srcset` image the page displayed to the source it displayed, narrowing the set of
one displayed from a width or a density other than 1x to that candidate (ADR-0055, D4), with the
network still recorded; collection stops after the screenshot and the count. The inventory's MHTML part carries
the true `pinnedImages` and `pinnedImagesNotLoaded` in place of step 6's zeros, covering only
images that had settled and displayed. A pin script that throws, or returns counts the strict
schema refuses, fails the render. A Duplicate re-anchors the part with the rest of the inventory
(D11). The print reads its height bound after the pin.

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

After this branch took `main`'s Electron 45.0.0 (#1994), the plan's re-check of
`Network.configureDurableMessages` ran on Electron 45.0.0 with Chromium 156.0.8078.48, on the
same workstation under `xvfb-run`: `e2e/recapture-transaction-record.spec.ts` passed all eight
tests against the built app. The other Recapture specs and the probe were not rerun there.

**Step 10.** The same workstation, Node 20.20.2, and Electron 44.9.1 with Chromium
152.0.7977.167. The unit suite ran as in step 6. The Recapture end-to-end specs ran against the
built app under `xvfb-run`, outside a network namespace: no process held the capture server's
port. pdf.js (`pdfjs-dist` 5.6.205) read the stored PDF in the spec's own process, on Node
20.20.2, with the optional `@napi-rs/canvas` 0.1.100 that pnpm installed beside it. The print
sizes and times below come from a standalone Electron 44.9.1 script outside the repository, one
process per page, in an offscreen sandboxed window on a fresh partition under `xvfb-run`, which
called `printToPDF({})`, the render's options, 1.5 s after each load.

After this branch took step 9's Electron 45.0.0, `e2e/recapture-transaction-record.spec.ts` and
`e2e/recapture.spec.ts` ran on Electron 45.0.0 with Chromium 156.0.8078.48, on the same
workstation under `xvfb-run`, outside a network namespace. The PDF cases passed. Three
Transaction Record cases first failed when the app's first window did not open within 30 s. On
the rerun, two passed, and the known-answers case failed twice: its fixture servers' logs held
`GET /` requests for `localhost`, which the record did not, of the kind the workstation's T3
Code server sent to a test listener on a new loopback port. With requests for `/` dropped from those logs, in an uncommitted
copy of the spec, it passed. The print sizes and times above were not measured again on Electron
45.

**#1843.** The same workstation, Node 20.20.2, and Electron 44.9.1 with Chromium
152.0.7977.167. The unit suite ran as in step 6, and the Recapture end-to-end specs against the
built app under `xvfb-run`, outside a network namespace. The browser behaviour listed under the
table comes from standalone Electron 44.9.1 scripts outside the repository, in an offscreen
sandboxed window on a fresh partition loading a fixture page from loopback. The first version
ran the review's pin script in the page's world; the fix round's ran the branch's four scripts,
read from the source, in the pin's isolated world as the render does: the settle poll up to
5,000 ms, the pin, the load poll up to 2,000 ms, the count, then `savePage(path, 'MHTML')`. Each
image response is a PNG followed by `TAG:<request path>`, and the server logs each request with
the phase it arrived in. The review of #2002 ran its own probes, which the fix round confirmed
from their stored output. On 2026-10-30 a further script ran the end-to-end spec's five-image
page through the render's steps in order (load, settle poll, screenshot, pin, load poll, count,
save) and switched one difference between the render and the review's probe on at a time; each
response there is tagged `TAG:<path>#<request number>`. For the ruling of 2026-10-30, a
measurement spec outside the repository ran Recaptures through the built app under `xvfb-run`,
once at `9674d147` (pin after the screenshot) and once at this round's code (pin before it), on
the end-to-end spec's five-image and `q2-savepage` pages and on three pages of its own, with
solid-color PNGs of known sizes tagged as above. It kept the screenshot, PDF, MHTML and
Transaction Record of each Capture; ImageMagick compared and sampled the screenshots, and
`pdfimages -list` read the image sizes in each PDF. The render's content area there was 639 by
479 CSS pixels.

For the second ruling of 2026-10-30 (ruling 8), after the branch took its base at `7a931716`,
the unit suite and the Recapture end-to-end specs ran on Electron 45.0.0 with Chromium
156.0.8078.48, on the same workstation under `xvfb-run`, outside a network namespace. A
standalone Electron 45.0.0 script outside the repository loaded a page of ten `srcset` images
from loopback in an offscreen window on a fresh partition, 640 by 480, with Electron started
with `--no-sandbox`, waited 1.5 s, changed the images one way per run, waited 800 ms, took the full-page
screenshot as the render does, and saved the page. One run changed nothing, one set only each
`src`, two narrowed each set to `<url> <d>x` before and after setting `src`, two narrowed it to
`<url> 1000w` with `sizes` set to `1000 / d` pixels, and one ran the branch's four scripts read
from the source in world 1843. The server logged each request with its number, and the images
were solid PNGs of known sizes. For the PDF, a local copy of the end-to-end spec, not committed,
kept the PDF, screenshot and MHTML of the Capture of its order page, once with the branch's code
and once with the narrowing removed.

## Expected and observed results

**Step 6.**

| Check                                                                                                                                                                | Expected                                                                                                                                                                                                                                                                                                   | Observed                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each D5 ending, driven with a mocked `WebContents` (`tests/main/services/backgroundRenderer.test.ts`, `scrollToLoadLazyContent`)                                     | Budget zero records `ran: false` and no outcome; no scrollable root records `nothing-to-scroll`; a page at the scroll cap records `height-cap`; three steps without a change in height record `stopped-growing`; the phase deadline records `time-budget`                                                  | Each as expected, and each record passes the strict schema                                                                                                                 |
| The stall count (same file)                                                                                                                                          | A page that grows before the third stall step keeps scrolling; a step that moves on to a second pane, at a different height, restarts the count; a page whose height falls, or moves down and up, at every step runs to the deadline                                                                       | As expected                                                                                                                                                                |
| The root each step scrolls, with the step script run against a simulated page (same file, the step script's tests)                                                   | The document first; once it cannot move down, the inner panel with the most overflow that can; once nothing can move down, the root at its end with the most overflow, reported rather than `null`; `null` only when nothing overflows                                                                     | As expected for a document at its end, an app-shell page whose document overflows by its 16px margin, a page with two panes, and a panel that grows after reaching its end |
| Whether the phase lifts a scroll lock, with the unlock, step and reset scripts run against a simulated page (same file, the scroll lock's tests)                     | A page that starts at its end lifts no lock and records `scrollLockLifted` false; a page locked with `overflow: hidden` whose document cannot move from script, at its top or after it scrolled itself to its end, has the lock lifted, records true, and has the lock restored                            | As expected                                                                                                                                                                |
| A step that throws (same file)                                                                                                                                       | The phase rejects, so the render fails, and the page's scroll position and lock are restored                                                                                                                                                                                                               | As expected                                                                                                                                                                |
| A restore that fails (same file)                                                                                                                                     | With a lifted scroll lock, the phase rejects, so the render fails; a step's own error wins over the restore's; with no lock lifted, the failure is logged and the phase recorded                                                                                                                           | As expected                                                                                                                                                                |
| A height the page reports that is not a non-negative integer (same file)                                                                                             | No `endHeight`                                                                                                                                                                                                                                                                                             | As expected for a fraction, a negative number, and text, and for a fraction read after a whole height                                                                      |
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
| The render (`tests/main/services/backgroundRenderer.test.ts`)                                                                                                                             | `about:blank`, the page setup, then the target; collection stops before the screenshot; a page that ends on the blank page it went back to gets `boundTlsAbsent` `not-reported`; a failed `enable`, a body fetch that never settles, and a writer that throws each return the record as `failed`; no certificate allowance without the switch or in a packaged build                                                                                                                                                                                                                                                                    | As expected                                                                                                                                                                                                                             |
| The end reserve and the cut (same file)                                                                                                                                                   | No Scroll-to-load budget under a 34 s timeout, some under 37.5 s, so the reserve is 35 s; with a 3 s timeout, a body fetch or a writer that never settles is cut to the time left less the 1 s margin and the render returns its page with the record `failed`                                                                                                                                                                                                                                                                                                                                                                          | As expected; each cut ended between 1,000 and 2,000 ms                                                                                                                                                                                  |
| The notice that the record failed (`tests/main/services/recapture.test.ts`)                                                                                                               | Logged once the Capture is stored, with the error; not logged when the job then refuses the final URL or the ingest fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | As expected                                                                                                                                                                                                                             |
| Ingest and the Duplicate (`tests/main/services/recapture.test.ts`, `captureLifecycle.test.ts`)                                                                                            | The entry passes the strict schema with the record's hash, inventory part, and `boundTls` or `boundTlsAbsent`; the file is stored under the id the render was given; the row mirrors the entry; a changed byte reads `tampered`; a failed record writes no file and `not-recorded`; a Duplicate's entry and row carry the hash and no Bound TLS Details                                                                                                                                                                                                                                                                                 | As expected                                                                                                                                                                                                                             |
| Two peers over the in-process transport (`tests/main/services/sharing/syncPeers.test.ts`)                                                                                                 | A record altered in transit is refused as `hash-mismatch` and not written; the next session takes the genuine bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | As expected                                                                                                                                                                                                                             |
| An end-to-end Recapture of a fixture page with a cross-site frame, a dedicated worker in the page and one in the frame, and a service worker (`e2e/recapture-transaction-record.spec.ts`) | One request record for each request the servers logged, plus the cached second use, the page's copy of the response its service worker answered, and the request the consent filter blocked; `cached` 1, `cancelled` 1, `failed` 2, `inFlight` 1, `finishedWithoutResponse` 1, `recordedTargets` 5, `unrecordedTargets` 0; `exchanges` and `bodiesOmitted` equal to the response records and the truncated ones                                                                                                                                                                                                                         | As expected                                                                                                                                                                                                                             |
| Known answers in the same record                                                                                                                                                          | Payload digests equal the SHA-256 of the served bodies for a `gzip` body, a plain one, windows-1252, Shift_JIS, UTF-8 with a byte-order mark, and UTF-8 under a windows-1252 label; posted windows-1252 (`636166e9`), Shift_JIS (`93fa967b`) and UTF-8 bodies are stored as the bytes sent; both redirect hops, same-origin and cross-origin, have a `302` response with no body; the over-limit body and the page's copy of the service worker's answer are `WARC-Truncated`; the cookie the page set and sent appears nowhere in the inflated record; `WARC-IP-Address` 127.0.0.1; `boundTlsAbsent` `not-https`; the Capture verifies | As expected                                                                                                                                                                                                                             |
| A page that fetches in a loop for as long as it is open (same file)                                                                                                                       | The Capture is stored and verifies, with the record absent as `failed`, `boundTlsAbsent` `not-recorded`, and no record file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | As expected; the server logged more than 8,000 of its requests                                                                                                                                                                          |
| Stubbed setup failures (same file)                                                                                                                                                        | A frame's failed `Network.enable` moves `unrecordedTargets`; the page's failed `Target.setAutoAttach` makes the page unrecorded; both keep the record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | As expected: 2 unrecorded for the frame and the worker it starts, 1 for the page                                                                                                                                                        |
| A page over TLS through the test certificate allowance (same file)                                                                                                                        | `boundTls` states the leaf's subject, alternative names, issuer, and validity; a page that goes back to the blank page the window loaded first, or sets `location.href` to `about:blank`, is stored under `about:blank` with `boundTlsAbsent` `not-reported`; without the allowance the Recapture fails with `ERR_CERT_AUTHORITY_INVALID`                                                                                                                                                                                                                                                                                               | As expected                                                                                                                                                                                                                             |
| A proxy Egress through the SOCKS5 fixture (same file)                                                                                                                                     | No `WARC-IP-Address`, and neither the record nor the inventory names the proxy's port; the proxy shares the target's host, 127.0.0.1, so this does not show the host left out                                                                                                                                                                                                                                                                                                                                                                                                                                                           | As expected                                                                                                                                                                                                                             |
| The other Recapture specs (`e2e/recapture.spec.ts`, `recapture-consent.spec.ts`, `recapture-egress.spec.ts`, `recapture-permissions.spec.ts`, `recapture-local-redirect.spec.ts`)         | Pass with the Network domain on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | All passed, in one run with the new spec: 18 of 18                                                                                                                                                                                      |
| `warcio check` (`warcio` 1.8.1) on the five records that run stored                                                                                                                       | Exit 0, every digest it checks passing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Exit 0 on each, with no output; verbose, the fixture page's 61 records (one `warcinfo`, 33 requests, 27 responses) gave 60 `digest pass` and one `no digest to check` for the `warcinfo`, and the four smaller records the same pattern |
| D15's probe, `xvfb-run --auto-servernum node scripts/capture-probe/run.mjs`                                                                                                               | The on pass sends `Network.enable`, `Network.configureDurableMessages`, and `Target.setAutoAttach`; the passes agree on `navigator.webdriver`, the `window.chrome` keys, the `Error.stack` getter count, and the resource timing list; `history.length` 1 off and 2 on                                                                                                                                                                                                                                                                                                                                                                  | As expected, exit 0                                                                                                                                                                                                                     |
| Record sizes (plan, open question 3)                                                                                                                                                      | Reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 37,168 bytes for the fixture page above, the largest; 1,879 to 2,643 bytes for the stub, TLS, and proxy pages; 3,248 to 3,385 bytes for each of the three demo fixture pages (`scripts/demo-fixture/pages/`)                            |
| The writer at the 50,000,000-byte cap                                                                                                                                                     | Inside its 10 s bound                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Five 7,500,000-byte bodies held as base64: 1,397 ms for random bytes, 37,515,985 bytes written; 410 ms for one repeated byte                                                                                                            |

**Step 10.**

| Check                                                                                                                                                                                                                       | Expected                                                                                                                                                                                                                                                                                                                                                                                                                  | Observed                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The print's order and options (`tests/main/services/backgroundRenderer.test.ts`)                                                                                                                                            | `printToPDF` called once, with `{}`, after the screenshot, `savePage`, and the Transaction Record writer                                                                                                                                                                                                                                                                                                                  | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| A request the page starts while it prints (same file)                                                                                                                                                                       | Not in the Transaction Record, which holds the one exchange made before collection stopped                                                                                                                                                                                                                                                                                                                                | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| The print's bound and the cut (same file)                                                                                                                                                                                   | Under a 30 s timeout, a print that never settles records the PDF `failed` at its 5,000 ms bound; under a 3 s timeout it is cut to the time left less the 1 s margin; when the record phases have used the time left, the print does not start; a print that throws records `failed`; the render returns its page each time                                                                                                | As expected; the cut print ended inside the 1,000 to 2,000 ms the test allows                                                                                                                                                                                                                                                                                                      |
| The end reserve (same file)                                                                                                                                                                                                 | No Scroll-to-load budget under a 39 s timeout, some under 42.5 s, so the reserve is 40 s                                                                                                                                                                                                                                                                                                                                  | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| The size bounds (same file)                                                                                                                                                                                                 | A page whose content height is 50,001 CSS pixels is not printed and one at 50,000 is; a PDF of 104,857,601 bytes is discarded and one of 104,857,600 bytes kept; each refusal records `failed` with an error that names its constant                                                                                                                                                                                      | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| The render handed to the Recapture queue and ingest (same file)                                                                                                                                                             | A printed PDF is stored as `{captureId}.pdf`, its hash signed and mirrored, the entry passing the strict schema, and a changed byte reads `tampered`; a print that never settles, a page over the layout bound, and a PDF over `MAX_PDF_SIZE` each store a Capture that verifies, with the PDF absent as `failed`, no `.pdf` file, no hash, and one `backgroundRenderer.pdf_failed` log entry whose error names the bound | As expected; the case that never settles stored inside 5.2 s of its 30 s timeout                                                                                                                                                                                                                                                                                                   |
| Ingest, the notice, and the Duplicate (`recapture.test.ts`, `captureLifecycle.test.ts`, `captureDuplicate.test.ts`)                                                                                                         | The notice is logged once the Capture is stored, and not for a printed PDF or a failed ingest; ingest with no PDF writes no file; a Duplicate's entry re-anchors `pdfHash`, and its row mirrors it and `transactionRecordHash`                                                                                                                                                                                            | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| Two peers over the in-process transport (`tests/main/services/sharing/syncPeers.test.ts`)                                                                                                                                   | A PDF altered in transit is refused as `hash-mismatch` and not written; the next session takes the genuine bytes                                                                                                                                                                                                                                                                                                          | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| Both shipped verifiers (`tests/main/services/verifyRunbookExecution.test.ts`)                                                                                                                                               | A package exported from a Capture whose PDF the ingest stored passes Package Verification and `verify.sh`, which reports `0 Transaction Record(s) and 1 PDF(s) bound to the signed chain`; a changed byte in the packaged PDF fails both, `verify.sh` at step 5                                                                                                                                                           | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| An end-to-end Recapture of the probe's print-only image fixture (`e2e/recapture-transaction-record.spec.ts`)                                                                                                                | The server logs `/print-only.png` and no request record names it; the stored PDF hashes to `pdfHash`; pdf.js reads one Letter page, 612 by 792 points, holding the fixture's text; the Capture verifies; a package exported from it passes Package Verification, and a changed PDF byte fails its `pdf` check                                                                                                             | As expected                                                                                                                                                                                                                                                                                                                                                                        |
| The same case with the print moved before collection stops (a local edit, reverted)                                                                                                                                         | The case fails                                                                                                                                                                                                                                                                                                                                                                                                            | Failed on the record's request list, which held `/print` and `/print-only.png`                                                                                                                                                                                                                                                                                                     |
| A page that navigates after the save (`backgroundRenderer.test.ts`), the review of #2000, finding 2                                                                                                                         | To another page, by reloading itself, or to another address in place: the render returns the URL, title, and status read at the save, does not call `printToPDF`, and records the PDF `failed` with an error naming the later address                                                                                                                                                                                     | As expected; each of the three failed before the fix                                                                                                                                                                                                                                                                                                                               |
| The same, through the Recapture queue and ingest (same file)                                                                                                                                                                | The Capture is stored under the saved page's URL and title, verifies, and has the PDF absent as `failed` and no `.pdf` file                                                                                                                                                                                                                                                                                               | As expected; before the fix it was stored under the later page's URL                                                                                                                                                                                                                                                                                                               |
| A slow proxy setup (same file), finding 5                                                                                                                                                                                   | With `setProxy` taking 2 s under a 4 s timeout, a print that never settles is cut to the time left counted from the deadline timer, and the render returns its page                                                                                                                                                                                                                                                       | As expected; before the fix the render timed out and nothing was stored                                                                                                                                                                                                                                                                                                            |
| An entry the strict schema refuses (`captureLifecycle.test.ts`), finding 6                                                                                                                                                  | A PDF beside an inventory that marks it absent fails the ingest before signing: the manifest is unchanged, and no row or file remains                                                                                                                                                                                                                                                                                     | As expected; before the fix the entry was signed                                                                                                                                                                                                                                                                                                                                   |
| An end-to-end Recapture of a page that navigates after the save (`e2e/recapture-transaction-record.spec.ts`; the test patches `executeJavaScript` in its own launch so the page moves to `/nav-b` once its text is read)    | The server serves `/nav-b`; the Capture is stored under `/nav-a` with no `finalUrl`, title `Nav A`, the saved page's text, the PDF absent as `failed`, and no `.pdf` file, and it verifies                                                                                                                                                                                                                                | As expected; with the save-time reads and the navigation check reverted locally, the case failed on the stored URL, `/nav-b`                                                                                                                                                                                                                                                       |
| The dependency audit (`node scripts/audit-check.mjs`)                                                                                                                                                                       | GHSA-hq66-cqwq-w95j accepted until 2026-12-31, and no blocking advisory                                                                                                                                                                                                                                                                                                                                                   | Exit 0                                                                                                                                                                                                                                                                                                                                                                             |
| Every Recapture end-to-end spec (`recapture-transaction-record.spec.ts`, `recapture.spec.ts`, `recapture-consent.spec.ts`, `recapture-egress.spec.ts`, `recapture-permissions.spec.ts`, `recapture-local-redirect.spec.ts`) | Pass with the print added                                                                                                                                                                                                                                                                                                                                                                                                 | 19 of 19 in one run, after step 6's case in `recapture.spec.ts`, which expected the PDF `not-taken`, was changed to expect the printed part and the mirrored hash; after the fix round, 20 of 20 in one run, with the navigation case. An earlier run of the fix round failed the consent spec at setup, when the app's first window did not open within 30 s, and it passed alone |
| PDF sizes (plan, step 10, the size bounds)                                                                                                                                                                                  | Reported                                                                                                                                                                                                                                                                                                                                                                                                                  | 5,578 to 19,616 bytes for the six PDFs the end-to-end spec stored, the fixture page with a frame and workers the largest; 41,003 to 56,925 bytes for the three demo fixture pages (`scripts/demo-fixture/pages/`)                                                                                                                                                                  |

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
PDF, 90,084,033 bytes, stays under `MAX_PDF_SIZE`, so a page as dense as the fixture, and laid
out the same on screen and in print, is not printed only to be discarded (False positives and
negatives has a page that is not). `MAX_PDF_SIZE` is 104,857,600 bytes, the screenshot's bound
(`MAX_SCREENSHOT_SIZE`). The print's own bound, 5 s, is 2.6 times the slowest print measured at
the layout bound.

**#1843.**

| Check                                                                                    | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Observed                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The pin scripts over fake images (`tests/main/services/backgroundRenderer.test.ts`)      | Over the triage's five images and three left-alone `srcset` images (still loading with no `currentSrc`, failed, and `blob:`), the pin returns 3: the three displayed images outside a `picture` get their `currentSrc` as `src` and keep `srcset` and `sizes`, and the rest are untouched; a page with no `srcset` image pins 0; the settle count sees only a considered image still loading; a pinned image counts as not loaded while it loads and after the load fails; an image the page removed or re-pointed since the pin is not counted; the load and count scripts throw when the world holds no pin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | As expected                                                                                                                                                            |
| The main process's waits and the schema check (same file)                                | Under fake time, the settle wait ends once the image settles at 120 ms, ends at exactly 2,000 ms for one that never does, and checks once with no time; the pin waits 1,000 ms on the main clock for an image that never loads, and the count then returns 3 and 1; every call goes to world `PIN_WORLD_ID`; a not-loaded count above the pinned count, a fraction, a negative, a missing count, and no object each reject, as does a script that throws                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | As expected                                                                                                                                                            |
| The pin in the render (same file)                                                        | The order is the settle poll, the pin, the load poll, `Page.captureScreenshot`, the count, then `savePage`; the screenshot sees each pinned `src` set; requests during the pin and the screenshot are in the Transaction Record and one during the save is not; under a 39 s timeout each wait polls once, and under 60 s each spans 4,900 to 5,500 ms; an image still loading at the settle wait's end that loads before the pin is left out; under a 3 s timeout an image that never loads is counted and the render returns inside 3 s; a page the pin makes taller than `MAX_PDF_CONTENT_HEIGHT_PX` has a screenshot record of that height and is not printed; a pin script that throws fails the render with no screenshot and no `savePage`; contradictory counts, and a page replaced during the screenshot, fail it with no `savePage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | As expected                                                                                                                                                            |
| Step 9's stop test (same file)                                                           | A request made during `savePage` is not recorded; it was made during the screenshot until collection moved after the pin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | As expected                                                                                                                                                            |
| The render with the pin moved back after the screenshot (a local edit, reverted)         | The render's pin tests fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 5 failed: the order, the screenshot seeing the pin, the height bound, a throwing pin, and a page replaced during the screenshot                                        |
| The render handed to the Recapture queue and ingest (same file)                          | The entry's MHTML part signs 3 pinned and 1 not loaded and passes the strict schema, the row mirrors the inventory, the Capture verifies, and a Duplicate's entry and row carry the same part; a pin that throws emits `failed` and stores no Capture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | As expected                                                                                                                                                            |
| Ingest and the Duplicate (`recapture.test.ts`)                                           | The part the render returns is signed, mirrored, and re-anchored by a Duplicate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | As expected                                                                                                                                                            |
| The report (`reportCaptureEngine.test.ts`)                                               | The artifact inventory states both counts, defines the second, and says what the counts cover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | As expected                                                                                                                                                            |
| End-to-end Recaptures (`e2e/recapture-image-sources.spec.ts`)                            | The renderer spike's `q2-savepage` fixture: one request for `/savepage/srcset-1x.png` and a part holding its response `#1`, no request for `/savepage/srcset-2x.png`, and counts 1 and 0. The triage's five images, the `400w` candidate a 400 by 400 file: one request for each displayed source in the server log and in the Transaction Record, and a part holding response `#1`; no part at an address the server never served (`/five/src-fallback.png` was not requested), counts 3 and 0, a Duplicate re-anchoring them, and an exported package passing Package Verification and `verify.sh`. A page whose displayed sources are not first in their sets (`2x, 1x`, and `800w, 400w` at `sizes="200px"`): one request and part `#1` each, none for the other candidates, the saved `img`s with only `src` and, for the second, `width="200" height="200"`; on the same page images offered only at `2x` and only at `1.5x`, solid 400 and 240 pixel files: one request each in the server log and in the Transaction Record, part `#1`, a box of 200 by 200 and 160 by 160 pixels of their colors in the stored screenshot, and saved `img`s with `width` and `height` 200 and 160; counts 4 and 0. A page with a failed image the server would answer a second time, a revoked `blob:` image, one never answered and one answered after 1 s: counts 1 and 0, one request and part `#1` for the last, none for the failed or unanswered ones, one request for the failed image in the server log and in the Transaction Record | As expected                                                                                                                                                            |
| The left-alone case with the displayed-only check removed (a local edit, reverted)       | The case fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Failed on the counts                                                                                                                                                   |
| The `q2-savepage` case with the rewrite disabled (a local edit, reverted, first version) | The case fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Failed: the MHTML had no part for the `srcset` image                                                                                                                   |
| Every Recapture end-to-end spec but the Transaction Record known-answer test             | Pass with the pin before the screenshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 23 of 23 in one run at the round that moved the pin; the known-answer test fails locally because another local service sends `GET /` to each new loopback port, and is left to CI |
| The narrowing (`backgroundRenderer.test.ts`)                                              | An image displayed at `2x`, `1.5x`, `3x` after a `0.5x`, or `2x` with a `src` it did not display gets `srcset` `<url> 1000w`, `sizes` `500px`, `666.6666666666666px` or `333.3333333333333px`, and `src` `<url>`; one displayed from `400w` gets `<url> 400w` with the page's `sizes`, and so does one whose `src` is also that `400w` candidate; one displayed from its `src` or a 1x candidate keeps its set; one whose `src` shares its URL with a 2x candidate, one listed at two densities and one not in its set keep their sets; the standard's parser keeps a URL with a comma and drops a zero width, a height with no width, a bad or negative density, and a parenthesised list | As expected                                                                                                                                                            |
| The same tests with the narrowing removed (a local edit, reverted)                        | They fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 13 failed                                                                                                                                                              |
| The order page end to end with the narrowing removed (a local edit, reverted)             | The case fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Failed: two requests for the 2x-only image                                                                                                                             |
| A reload before the pin, during its load wait, or during the screenshot (`backgroundRenderer.test.ts`) | Collection stops after the screenshot, so the page a reload loads holds no pin: the pin, the load poll or the count throws, and the render fails with no save, so nothing is stored and no Bound TLS Details are signed, as the maintainer ruled on 2026-10-30 ([ruling](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6537101827))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | As expected                                                                                                                                                            |
| The `src`-as-`400w` case with `src` added as 1x beside width candidates, or always added (local edits, reverted) | The case fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | As expected; 1 of 153 failed under each                                                                                                                                |
| Every Recapture end-to-end spec, at ruling 8's code on Electron 45.0.0                   | Pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 27 of 27 in one run, the known-answer test included                                                                                                                    |

What the standalone scripts showed:

- With no screenshot before the pin, no request reached the server during the pin for an image
  that had loaded, a `no-store` one included. Each was `complete` with a natural width straight
  after its `src` was set, and the MHTML held a part at its address, under a saved `img` naming
  that address. Until 2026-10-30 the app took its full-page screenshot between the settle wait
  and the pin, and in the end-to-end run of 2026-10-29, with each response tagged with its request number, the pin
  asked again for every pinned image, the Transaction Record held both requests, and the MHTML
  part held the second response. An image the pin left alone was asked for once.
- The screenshot is why the app asked again (script of 2026-10-30). Each of these alone left the
  pin with no request: `Network.enable` with the recorder's buffer limits,
  `Network.configureDurableMessages`, `Target.setAutoAttach` with `waitForDebuggerOnStart`, the
  idle tracker's three `webRequest` listeners, and an `onBeforeRequest` handler. The render's
  screenshot alone, `Page.captureScreenshot` with `captureBeyondViewport`, made the pin request
  all three pinned images again, and each MHTML part held request `#2`. So did the same call with
  no clip, and `Emulation.setDeviceMetricsOverride` followed by its clear with no screenshot, at
  a height of 3,000 pixels or at the window's own size. A screenshot of the viewport only, a 3 s
  wait, and resizing the window to 3,000 pixels high and back sent no request.
- After that override the pin's loads reached the browser's network stack, which followed each
  image's cache headers. With `Cache-Control: max-age=3600` the HTTP cache answered each one
  (`fromDiskCache` true), the server had one request per image, and each part held request `#1`.
  With no cache header, with `no-store`, and with `no-cache` and an `ETag` (the script's server
  answers 200 every time), the server was asked again and each part held request `#2`.
- Keeping a detached `Image`, or a `link rel=preload`, for each displayed source from before the
  screenshot did not stop the second request. Setting each `src` to its `currentSrc` before the
  screenshot, with `srcset` and `sizes` left in place, sent no request: the saver wrote each
  `img` with that `src` and no `srcset` or `sizes`, the parts held request `#1`, and the counts
  were 3 and 0. The maintainer's ruling of 2026-10-30 adopted that order; what the app then
  showed is under "The pin before the screenshot" below.
- A `srcset` image answered with a 404, or with a 200 that is not an image, has a `currentSrc`
  and a natural width of 0. Under the first version's script, pinning it sent a second request
  during the pin, and the review's probe found that a second request the server answers lands in
  the MHTML. Under the fix round's scripts such an image was left as it was: no second request,
  and no part.
- A `srcset` image still loading had an empty `currentSrc`. One inserted after load and answered
  after 1 s had settled before the settle poll and was pinned; one answered after 20 s was still
  loading after the 5,000 ms poll, was left as it was, and had no part.
- A `loading="lazy"` `srcset` image 3,000 pixels down, never scrolled to, stayed not `complete`
  through the whole 5,000 ms settle poll (98 polls) and was left out.
- A `blob:` image the page revoked once it loaded was displayed (natural width 1) and was left as
  it was; the review's probe found the first version re-sourced it to a natural width of 0.
- A `400w` candidate shown at `sizes="10px"` had a natural size of 10 by 10 from a 400 by 400
  file and was pinned, and 0 by 0 from a 1 by 1 file, which was left as it was, with no part.
- An image in an open or a closed shadow root, and one in a same-origin frame, were not pinned
  and had no part; the saver wrote each as an `img` with no source.
- Under the scripts of 2026-10-29, which removed `srcset` and `sizes`, an image with no `width`
  or `height` attribute, offered at `2x` density or as `8w` with `sizes="2px"`, rendered at 2 by
  2 and 1 by 1 CSS pixels before the pin and at 4 by 4 after it.
  Three `srcset="/tall.svg 4x"` images of a 400 by 4,000 SVG took the page from 3,112 to 12,112
  CSS pixels tall, and its print from 7 to 16 pages.
- A page that replaced `Date.now`, `setTimeout`, the `currentSrc` getter and `removeAttribute`
  in its own world did not change the isolated world's pin, and the page could not see what the
  pin kept. A `MutationObserver` that put one image's `srcset` back took it out of the count of
  the first fix-round script, which also required no `srcset`; the saver still wrote that image
  under its pinned `src`, so the final script counts by `src` alone, and on the same page it
  counted 2 pinned and 0 not loaded.
- An SVG with a `viewBox` and no width or height reported a natural width of 150 and counted as
  displayed.

**The pin before the screenshot (2026-10-30).** The measurement spec's results at `9674d147`
(after) and at the code of the round that moved the pin (before), which set only `src`. Each
image path was served once at that code unless the row says otherwise. Ruling 8 changed the last
row; its measurements follow this list.

| Page and image                                                                                  | Pin after the screenshot                  | Pin before the screenshot                                                           |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Five-image page, the three pinned images                                                        | 2 requests each, part `#2`                | 1 request each, part `#1`                                                           |
| `q2-savepage`, `srcset-1x.png`                                                                  | 2 requests, part `#2`                     | 1 request, part `#1`                                                                |
| `srcset="d-2x.png 2x, d-1x.png 1x"`, displayed `d-1x`                                           | 2 requests, part `#2`                     | 1 request, part `#1`, no request for `d-2x`                                         |
| `srcset="w-800.png 800w, w-200.png 200w" sizes="100px"`, `w-200`                                | 2 requests, part `#2`, saved with no size | 1 request, part `#1`, no request for `w-800`, saved with `width="100" height="100"` |
| `srcset="v-100.png 100w, v-2000.png 2000w" sizes="50vw"`, `v-2000`                              | 2 requests, part `#2`, saved with no size | 1 request, part `#1`, no request for `v-100`, saved with `width="320" height="320"` |
| `src` with `srcset="... 2x"`, displayed the `src`; a single `200w` at `sizes="100px"`; `1x, 2x` | 2 requests each, part `#2`                | 1 request each, part `#1`; the `200w` one saved with `width="100" height="100"`     |
| `srcset="... 2x"`, `srcset="... 1.5x"`, and `srcset="... 2x"` with `width` and `height` 40      | 2 requests each, part `#2`                | 2 requests each, both in the Transaction Record, part `#2`                          |

- **Whether the browser chooses another candidate.** On the first page, whose displayed
  candidates are not the first in their sets, it did not: the server saw no request for any other
  candidate, the parts held request `#1`, and the screenshots at the two orders matched with 0
  differing pixels, as they did on the five-image and `q2-savepage` pages. It did for an image
  offered only at densities other than 1x. Setting `src` adds a 1x candidate to such a set, and
  from then on the image shows at 1x: a 2x-only 80 by 80 image the page displayed at 40 by 40
  filled 80 by 80 pixels of the screenshot at that code (sampled at 79, 79) and 40 by 40
  at `9674d147`, and that screenshot was 88 pixels tall rather than 48. The second request for
  such an image arrived during the screenshot: with collection stopped before the screenshot, the
  Transaction Record held one of the two requests while the part held `#2`, so collection now
  stops after the screenshot, and the record holds both. An image whose set has a 1x candidate,
  a width descriptor, or a `src` it displayed kept its copy.
- **Whether the PDF prints pinned images at another size.** On the five-image and `q2-savepage`
  pages it did not: every image has `width` and `height` attributes, and `pdfimages -list` gave
  the same sizes and resolutions at both orders (one page and four). On the first page it did.
  At `9674d147`, with `srcset` removed, the print laid out `w-200` at 200 CSS pixels and `v-2000`
  at 2,000, two and six times the widths displayed (100 and 320), and shrank the page to fit:
  every image at 144 pixels per inch, over 3 pages. At that code it printed each at its
  displayed width, 40, 100 and 320 CSS pixels (96, 192 and 600 pixels per inch), on 1 page. The
  single `200w` image printed at 192 pixels per inch rather than 96. Images offered only at
  densities other than 1x with no `width` and `height` printed at their natural size at both
  orders.

**Narrowing the set (ruling 8, 2026-10-30).** The standalone script's images, each 40 by 40 CSS
pixels as the page displayed it, and their width after the screenshot:

| Image                                                         | Nothing changed | `src` only        | `<url> <d>x`      | `<url> 1000w`, `sizes` `1000/d` px | The branch's scripts |
| ------------------------------------------------------------- | --------------- | ----------------- | ----------------- | ---------------------------------- | -------------------- |
| `srcset="a.png 2x"`, an 80 pixel file                         | 40              | 80, requested again | 80              | 40                                 | 40                   |
| `srcset="b.png 1.5x"`, a 60 pixel file                        | 40              | 60, requested again | 60              | 40                                 | 40                   |
| `srcset="c.png 2x" width="40" height="40"`                    | 40              | 40, requested again | 40              | 40                                 | 40                   |
| `srcset="d.png 0.5x, d3.png 3x"`, displayed `d3`, 120 pixels  | 40              | 120, requested again | 120            | 40                                 | 40                   |
| `src="e.png" srcset="e2.png 2x"`, displayed `e`               | 40              | 40                | 40                | 40                                 | 40                   |
| `src="f.png" srcset="f.png 2x"`, displayed `f` at 1x          | 40              | 40, requested again | 40, requested again | 40, requested again          | 40, requested again  |

- Narrowed to `<url> <d>x`, the 2x-only, 1.5x-only and 3x images showed at their natural size,
  because the browser added `src` to the set as a 1x candidate and chose it; they were not
  requested again. Narrowed to one width candidate with a `sizes` that gives the same density,
  each kept 40 by 40 with no second request, and the saver wrote `width="40" height="40"` into
  each saved `img` that had no size of its own. The order of setting `srcset` and `src` made no difference.
- With the branch's scripts, a `400w` image shown at `sizes="200px"` and a `2000w` one at
  `sizes="50vw"` kept 200 and 320 pixels with no second request, a `2x` image with `width` 40,
  `height` 40 and a CSS width of 50 pixels kept 50 by 40, and a URL holding an escaped comma was
  matched. The counts were 10 and 0.
- `f.png` is the case the pin cannot tell apart: `src` joins its set at 1x with the URL of its 2x
  candidate. Setting its `src` made the browser request it again in every run that set `src`,
  and the branch's scripts keep its set, so it is still requested again. The maintainer accepted
  this for the release on 2026-10-30, and confirmed the width form for density candidates
  ([ruling](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6536090389)).
- **The PDF of the order page.** With the narrowing, `pdfimages -list` gave the 400 pixel 2x-only
  image at 192 pixels per inch and the 240 pixel 1.5x-only one at 144, which print at 200 and 160
  CSS pixels, the sizes displayed, on 1 page. With it removed, both were at 96 pixels per inch,
  their natural size, and the screenshot showed the 2x-only image 400 pixels wide, cut off at
  the bottom of a screenshot 652 pixels tall, with no pixel of the 1.5x-only image's color. The
  `400w` image at `sizes="200px"` was at 192 pixels per inch in both.

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
- Review of that fix found that the check for a scroll lock still used the down-only test, so a
  document already at its end when the phase started, such as a page loaded at a fragment near
  its bottom, read as locked: the phase set `overflow: visible` on `html` and `body`, and the
  entry signed `scrollLockLifted: true`. The check now uses the step's root choice, so a root at
  its end is not a lock. On one locked page that also leaves the lock in place; the scroll-lock
  runs below show which.

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

Every change in height now restarts the stall count, so at its bottom a page whose height changes
at every step, down as well as up, runs to the height cap or the phase's time limit. The build
before step 6 counted a fall in height as a stall step, so a page that shrank at its bottom three
steps in a row stopped there.

The scroll lock, in Electron runs of the unlock and step scripts set up as the rows above, from
the source at `c7219ba3` (the same renderer file as `b4bd9b71`) and at `7b449b26`. Each page holds
a 5000 px block and a closing paragraph, the window shows 479 px, and each run read the page's
`document.compatMode` before the phase. Every page was loaded at its top and at the paragraph's
fragment. The build before step 6 recorded no outcome, so its column names where its loop ended
in D5's terms; "no height" means the first step found no root.

| Page                                                              | Loaded at | Before step 6                              | This step                             |
| ----------------------------------------------------------------- | --------- | ------------------------------------------ | ------------------------------------- |
| No doctype (`BackCompat`), no styles                              | top       | not lifted, `nothing-to-scroll` at 5058    | not lifted, `stopped-growing` at 5058 |
| No doctype, no styles                                             | fragment  | lifted, `nothing-to-scroll`, no height     | not lifted, `stopped-growing` at 5058 |
| No doctype, `overflow: hidden` on `html` and `body`               | either    | not lifted, `nothing-to-scroll`, no height | the same                              |
| No doctype, `height: 100%; overflow: hidden` on `html` and `body` | either    | lifted, `nothing-to-scroll` at 5042        | lifted, `stopped-growing` at 5042     |
| Doctype (`CSS1Compat`), no styles                                 | top       | not lifted, `nothing-to-scroll` at 5058    | not lifted, `stopped-growing` at 5058 |
| Doctype, no styles                                                | fragment  | lifted, `nothing-to-scroll`, no height     | not lifted, `stopped-growing` at 5058 |
| Doctype, `overflow: hidden` on `html` and `body`                  | top       | not lifted, `nothing-to-scroll` at 5066    | not lifted, `stopped-growing` at 5066 |
| Doctype, `overflow: hidden` on `html` and `body`                  | fragment  | lifted, `nothing-to-scroll`, no height     | not lifted, `stopped-growing` at 5066 |
| Doctype, `height: 100%; overflow: hidden` on `html` and `body`    | top       | not lifted, `nothing-to-scroll` at 487     | not lifted, `stopped-growing` at 487  |
| Doctype, `height: 100%; overflow: hidden` on `html` and `body`    | fragment  | lifted, `nothing-to-scroll` at 5042        | not lifted, `stopped-growing` at 487  |

A script can scroll a standards-mode document styled `overflow: hidden`, so neither build reads
those pages as locked when they load at their top. With `height: 100%` the document overflows
by 8 px, and the 5000 px block scrolls inside `body`, which neither build's step considers: its
inner roots are the descendants of `body`. Loaded at the fragment, that document starts at its
8 px end. The build before step 6 read that as a lock, lifted it, and scrolled to 5042; this step
reads a root at its end, lifts nothing, and ends `stopped-growing` at 487; loaded at its top,
that page stops at 487 in both builds. So on that page, loaded at the fragment, the phase no
longer loosens the lock and scrolls none of the block, where the build before step 6 scrolled all
of it. In quirks mode the full-height document cannot move from script, so both builds lift its lock
wherever the page loads.

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
- The second review of #1999 found that the main document was the main frame's last document
  request, whatever became of it, so a later navigation that did not replace the page, such as a
  download, supplied the signed Bound TLS Details. The main document is now the last one that
  replaced the page. What replaced it was measured on Electron 45.0.0 with Chromium
  156.0.8078.48, in a standalone script outside the repository that loaded a page, navigated it
  after 300 ms, and read the window's URL and title 2.5 s later:

  | The second navigation                           | Its events                                         | The window showed |
  | ----------------------------------------------- | -------------------------------------------------- | ----------------- |
  | A 204 answer                                    | response 204, then `loadingFailed`, canceled true  | the first page    |
  | An attachment (`Content-Disposition`)           | response 200, then `loadingFailed`, canceled true  | the first page    |
  | Replaced by a third navigation before answering | `loadingFailed`, canceled true, no response        | the third page    |
  | A server that never answers                     | `requestWillBeSent` only                           | the first page    |
  | A body still streaming                          | response 200, no terminal event                    | the second page   |
  | A body cut short after its response             | response 200, then `loadingFailed`, canceled false | the second page   |
  | Port 1, which the browser refuses               | `loadingFailed`, canceled false, no response       | the second URL    |

- The third review of #1999 found that a navigation that sends no request left the main document
  on the earlier page: a page that went back to the blank page the window loads first, or set
  `location.href` to `about:blank`, was stored under `about:blank` with the earlier page's Bound
  TLS Details. The maintainer ruled on 2026-10-29 that the entry then records the details absent,
  and that the blank first page stays. The details are now signed only when the main document's
  URL, without its fragment, is the URL of the window's last cross-document navigation, as
  Electron's `did-navigate` reports it; otherwise `boundTlsAbsent` is `not-reported`. Measured on
  Electron 45.0.0 in a standalone script outside the repository: `history.back()` to the blank
  page and `location.href = 'about:blank'` each sent no Network event and reported `did-navigate`
  with `about:blank`; a page loaded with a fragment reported `did-navigate` with the fragment,
  which the debugger's URL leaves out; `history.pushState` reported only `did-navigate-in-page`;
  and a 204 answer and an attachment each reported no `did-navigate`. So a navigation of either
  kind whose cancel arrives after collection stops, which the collector then takes as the main
  document (finding 4 of that review, not measured), leaves the details absent instead of signing
  its own.

**Step 10.**

- The review of #2000 found that a page that navigated after the save was printed as the later
  page, and its Capture stored under the later page's URL and title, beside an MHTML and a
  screenshot of the first page, with nothing in the signed entry saying so. Step 9 opened the
  URL half, by reading the URL after the Transaction Record's end phases; step 10 added the PDF
  half and up to 5 s more. A rerun of the review's standalone script on Electron 44.9.1 read the
  URL at the save as `/nav-a` and at the print as `/nav-b`, and the MHTML held page A. The render
  now reads the URL, title, and HTTP status right after the save, stores the Capture under them,
  and does not print when the window's URL or its count of main-frame navigations has changed
  since; the PDF is then absent as `failed` (Expected and observed results).
- The pre-pass reviews of #2000 at `39ae663a` found that the check ran once, before the print, so
  a navigation the window reported only once the print was under way passed it; neither review
  reproduced it. The render now checks the URL and the navigation count again when `printToPDF`
  settles, and discards the PDF on a change. Three unit tests in
  `tests/main/services/backgroundRenderer.test.ts`, one for each kind of navigation, pin it. A
  navigation the window has not reported by then is not seen.
- The same review found that the time left was counted from after the proxy setup while the
  deadline timer started before it, so a `setProxy` slower than the 1 s margin could let the
  print, or a record phase, settle after the deadline and lose the Capture. The count now starts
  with the deadline timer.
- The same review found that ingest signed the capture entry without parsing it whole, so a pair
  the strict schema refuses would have broken the Case's chain. On the ingest of a Capture
  carrying the capture engine's fields, the entry is now parsed before it is signed, and one that
  fails is not written.
- On taking step 9's committed-page rule (ruled 2026-10-29), the render reads the URL of the
  window's last cross-document navigation at the save, with the URL, title, and status, and the
  Transaction Record's end phases compare the main document with that URL. Step 9 read it after
  the text, where it also read the URL the Capture was stored under. Read there beside a Capture
  that keeps the saved page, it would leave out the saved page's Bound TLS Details when the page
  navigated after the save, and would sign the earlier page's details when the page went back to
  the blank page before the save and returned after it. Two unit tests in
  `tests/main/services/backgroundRenderer.test.ts` pin the Bound TLS outcome of both cases.
- The next review found that a reload of the same address after collection stopped and before
  the save still signed the earlier load's Bound TLS Details, though the record holds no request
  for the reloaded page. The maintainer ruled on 2026-10-30 that any navigation in that span, a
  same-address reload included, records the details absent. The render now counts the window's
  cross-document navigations when collection stops and again at the save, and passes no committed
  URL when the two differ, so `boundTlsAbsent` is `not-reported`. A unit test in the same file
  reloads the same address during the save, after collection stops; it fails with the count
  comparison removed. Since #1843 collection stops after the screenshot, so a navigation during
  the pin or the screenshot is before it; the page it loads holds no pin, so the count after the
  screenshot throws and the render saves nothing, which a unit test in the same file pins.
- The plan leaves unverified whether pdf.js extracts text without the optional `@napi-rs/canvas`.
  It does not: with no `@napi-rs/canvas` to load, the 5.6.205 legacy build stops at import on
  Node 20.20.2 with `ReferenceError: DOMMatrix is not defined`. pnpm installs the optional
  package by default, and with it the same build read the stored PDFs. The maintainer accepted
  the packages on 2026-10-26 (Scope).

**#1843.**

- The triage brief asks for a separate report row, `Image sources: N pinned to the displayed
image`, absent when N is 0. Step 5's sentence in the report's artifact inventory (#1985) states
  both counts instead, shown at 0 too, and now says what they cover, so the counts are stated
  once. The maintainer accepted this as built on 2026-10-29, in place of the brief's wording
  ([ruling 5](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6515710604)).
- The first version pinned every `srcset` image with a `currentSrc`, as the brief worded it, which
  pinned a failed image after collection stopped. The ruling of 2026-10-26 pins only an image that
  displayed and moves collection's stop after the pin.
- The ruling of 2026-10-26 defines `pinnedImagesNotLoaded` as a displayed image whose pinned
  source had not finished loading when the wait ended. The render also counts one whose pinned
  source finished without an image, so a loaded count never stands for an image the saved page
  lacks. The maintainer accepted this as built on 2026-10-29
  ([ruling 3](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6515710604)).
- A `blob:` image that displayed is left as it is, so re-sourcing cannot break it: the page may
  have revoked the address, and the render cannot tell without loading it. The maintainer
  accepted this as built on 2026-10-29
  ([ruling 4](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6515710604)).
- The settle wait first decided only how long the render waited: the pin tested each image again
  after the screenshot, so an image still loading when the wait ended that finished during the
  screenshot was pinned and counted. The wait's last check now keeps the images still loading,
  and the pin leaves them out, as ruling 2 of 2026-10-26 states
  ([confirmed 2026-10-29](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6515710604)).
- The ruling of 2026-10-21 has the pin remove `srcset` and `sizes`. Since the
  [ruling of 2026-10-30](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6534767262)
  the pin sets `src` and leaves both on the live page, as the investigation's first option
  proposed, and the serializer drops them from the saved page, so the saved `img` is the same.
  Removing them before the screenshot would show every image displayed at a density other than
  1x at its natural size in the screenshot; this round did not measure that.

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

- `failed` on the PDF part covers a print that failed, one that ran out of time, one refused by a
  size bound, and one refused or discarded because the page navigated after the save. The signed
  entry does not say which; the `backgroundRenderer.pdf_failed` log entry's error names the bound,
  or the address the page navigated to.
- The layout bound reads the content height the screenshot record states (D6), the document's
  content box, so it does not see the height of a panel that scrolls inside the page. Since #1843
  the screenshot, and so that height, is taken after Image Source Pinning.
- The layout bound measures the page as laid out on screen, and print styles can lay out far
  more. In the review's standalone run, a page 479 CSS pixels tall on screen, whose print style
  showed 150 random-pixel 600 by 400 images the screen hid, passed the bound and printed to
  108,106,623 bytes, in 6,091 ms there and in 2,365 ms in this step's rerun. In a render, such a
  print either outlasts its 5 s bound or exceeds `MAX_PDF_SIZE`, and the PDF is absent as
  `failed`; in the second case the main process has held the whole PDF first.
- A page that changes its address in place after the save, through `history.pushState`,
  `history.replaceState`, or a new fragment, gets no PDF, although the print would have shown the
  same document.

**#1843.**

- `pinnedImagesNotLoaded` is read at the count after the screenshot, just before collection
  stops and `savePage` runs. An image that finishes between the count and the save is still
  counted, so the count can overstate what was missing at the save, never understate it.
- The pin scripts run in an isolated world, so the page cannot replace what they call or change
  what they return, and the final count is taken again over the DOM. The page still owns the DOM:
  a page script that changes a pinned image's `src` back between the final count and the save
  makes the counts describe a pin the saved page does not hold. The strict schema refuses only
  counts that are not whole numbers or that contradict each other.
- An image that displayed from a natural size below one pixel, which a large `srcset` density
  gives a small file, counts as not displayed and is left out.

## Known limitations

**Step 6.**

- `endHeight` is the height of the root the step scrolled. On a page that scrolls an inner
  container, that is the container's height, not the document's.
- In standards mode the step never scrolls `body`: the document is `html`, and its inner roots
  are the descendants of `body`. A page with a doctype and `height: 100%; overflow: hidden` on
  `html` and `body` scrolls its content there, so the phase lifts no lock and stops at the
  document's 8 px overflow; the scroll-lock runs above give the numbers.
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
  tells a Capture from this build apart from an earlier one in this respect. The extra history
  entry also gives the page a blank page to go back to; a Capture whose page is there when it is
  saved is stored under `about:blank` with no Bound TLS Details (ruled 2026-10-29).
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
  without a survey of real pages; only the looping fixture was run against it. Uploads count
  against it too: `Network.enable` is sent without `maxPostDataSize`, so a request event carries
  its upload as `postData` and again as base64 `postDataEntries`. On Electron 45.0.0 the event of
  one 11,000,000-byte upload was 25,667,678 characters of JSON, past the bound, so the record is
  `failed`; that of a 6,000,000-byte upload was 14,001,007, so two such uploads also go past it.
- Every fixture is HTTP/1.1 on loopback; no HTTP/2, HTTP/3, or remote server was recorded.

**Step 10.**

- The PDF is the page as Chromium prints it, with the page's print styles on Letter pages, with
  Electron's default options. What it shows can differ from the screenshot and the MHTML. A
  resource the page fetches only for printing is not in the Transaction Record; the inventory's
  `afterCollection` states that the print came after collection stopped.
- With the print's 5 s, the end reserve is 40 s (ruled 2026-10-26), so within the 120 s
  Recapture timeout the load, the idle waits, and Scroll-to-load share 80 s, where step 9 left
  them 85 s. A slow page can reach the Scroll-to-load time limit up to 5 s sooner than under step
  9 and hold less lazy content.
- The 5 s bound stops the render's wait for the print, not the print: nothing cancels
  `printToPDF`, so Chromium can go on printing after the render has stopped waiting, and a PDF
  that then arrives is dropped. Whether destroying the window after ingest stops a print in
  flight was not checked.
- The text is read in its own call after the URL and title, so a page that commits a navigation
  in between has the later page's text stored beside the saved page's MHTML. The PDF check then
  finds the navigation, and the PDF is absent, but the text is not checked.
- The size bounds and the print bound were chosen from invented fixtures on one Linux
  workstation. A page whose images are larger than the fixture's reaches `MAX_PDF_SIZE` at a
  lower height, and a slower machine can reach the 5 s bound on a long page; either records the
  PDF `failed`.
- `printToPDF` hands the whole PDF to the main process before its size can be read, so a PDF over
  `MAX_PDF_SIZE` is held in memory once before it is discarded.
- pdf.js, the test reader, needs the optional `@napi-rs/canvas` to load on Node 20 (Deviations).

**#1843.**

- The counts cover only images that had settled and displayed before the pin (ruled
  2026-10-26). Pinning reaches only the `img` elements of the page's own document: an image in a
  frame or a shadow root keeps its `srcset`, and the MHTML still lacks one offered only through
  it.
- An image still loading after the settle wait, one whose load failed, and a `blob:` image are
  left as they are and not counted, and the MHTML lacks any of them offered only through
  `srcset`. An image the page has not started loading, such as a lazy one below where
  Scroll-to-load stopped, holds the settle wait to its end.
- An image offered only at densities other than 1x, with no `width` and `height`, shows at its
  natural size from the pin on, in the screenshot, the saved page and the PDF, and the page can
  grow (under the scripts of 2026-10-29 the PDF of the tall SVG page went from 7 to 16 pages;
  this round did not rerun it). The screenshot loads such an image again, so the saved page holds
  the second response. An image shown from a width descriptor keeps its displayed size in all
  three: the live page keeps `sizes`, and the serializer writes its `width` and `height`.
- Both waits take at most 5 s each of the time left before the 40 s end reserve and nothing from
  the reserve. A page whose earlier phases used that time gets no wait: an image offered as a set
  still loading then is left out, and a pinned image that needed a new request counts as not
  loaded.
- Collection now stops after the pin and the screenshot, just before the save, rather than
  before the screenshot, so the Transaction Record can hold requests the page made during the
  pin and the screenshot that step 9's build did not record.
- A page that navigates to another page, even by reloading itself, before the pin, while the pin
  waits for images to load, or during the screenshot fails the Capture, and nothing is stored
  ([ruled 2026-10-30](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6537101827)).
  Before this change collection stopped before the screenshot, so a navigation during the
  screenshot gave a stored Capture with its Bound TLS Details recorded absent.
- A build with step 6 and without #1843 signs zeros that read the same as a pinning pass that
  found nothing. The maintainer ruled on 2026-10-26 that no release carries step 6 without
  #1843.

## Acceptance decision

Owed: the maintainer records it here before the release that ships the writers.
