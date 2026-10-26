# Capture engine first slice: validation record

**Date:** 2026-10-26

**Status:** Open. Step 6 of the
[first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md) starts this record, steps 9
and 10 extend it, and the maintainer records the acceptance decision before the release that
ships the writers (plan, D16). The acceptance decision is this record's approval, so nothing
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
Python `warcio` was not installed on the workstation, so the manual `warcio check` of ruling 26
did not run (Known limitations).

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

| Check                                                                                                                                                                                     | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Observed                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The page session's setup (`tests/main/services/transactionRecorder.test.ts`)                                                                                                              | `Network.enable`, `Network.configureDurableMessages`, then `Target.setAutoAttach`, each with the budget; an `enable` that fails or does not answer records nothing and resumes any target that attaches                                                                                                                                                                                                                                                                                                                         | As expected                                                                                                                                                                                                  |
| Each attached target's setup (same file)                                                                                                                                                  | A frame or a dedicated worker gets three commands together and is resumed once, after they answer or the 2 s bound runs out; a service worker is resumed with them; any other type is resumed at once and counted unrecorded; a target that attaches after collection stops is resumed and not counted                                                                                                                                                                                                                          | As expected                                                                                                                                                                                                  |
| The body budget (same file)                                                                                                                                                               | No fetch of a body whose reported length is over the per-resource limit, or whose four-thirds estimate would take the held total past the cap; a returned body over either limit is not kept; the returned length replaces the estimate                                                                                                                                                                                                                                                                                         | As expected, with the limits scaled down for the test                                                                                                                                                        |
| Text bodies (`src/packages/transaction-record/tests`)                                                                                                                                     | A text body is kept only from a session whose durable messages answered, judged by the session that reported `loadingFinished`; a base64 body from any session; the writer stores the served windows-1252 bytes, payload digest `sha256:f92b1f90c50a0068a6c9dfce9c853e9333a8337b6475fab8a4393f1b1fccd319`; no record carries `x-birdbrain-decoded-text`                                                                                                                                                                         | As expected                                                                                                                                                                                                  |
| The render (`tests/main/services/backgroundRenderer.test.ts`)                                                                                                                             | `about:blank`, the page setup, then the target; collection stops before the screenshot; a failed `enable`, a body fetch that never settles, and a writer that throws each return the record as `failed` before the deadline; no certificate allowance without the switch or in a packaged build                                                                                                                                                                                                                                 | As expected; the fetch that never settled ended at the 5 s bound                                                                                                                                             |
| Ingest and the Duplicate (`tests/main/services/recapture.test.ts`, `captureLifecycle.test.ts`)                                                                                            | The entry passes the strict schema with the record's hash, inventory part, and `boundTls` or `boundTlsAbsent`; the file is stored under the id the render was given; the row mirrors the entry; a changed byte reads `tampered`; a failed record writes no file and `not-recorded`; a Duplicate's entry and row carry the hash and no Bound TLS Details                                                                                                                                                                         | As expected                                                                                                                                                                                                  |
| Two peers over the in-process transport (`tests/main/services/sharing/syncPeers.test.ts`)                                                                                                 | A record altered in transit is refused as `hash-mismatch` and not written; the next session takes the genuine bytes                                                                                                                                                                                                                                                                                                                                                                                                             | As expected                                                                                                                                                                                                  |
| An end-to-end Recapture of a fixture page with a cross-site frame, a dedicated worker in the page and one in the frame, and a service worker (`e2e/recapture-transaction-record.spec.ts`) | One request record for each request the servers logged, plus the cached second use, the page's copy of the response its service worker answered, and the request the consent filter blocked; `cached` 1, `cancelled` 1, `failed` 2, `inFlight` 2, `recordedTargets` 5, `unrecordedTargets` 0; `exchanges` and `bodiesOmitted` equal to the response records and the truncated ones                                                                                                                                              | As expected, after the first deviation below was fixed: 24 exchanges, 2 bodies omitted                                                                                                                       |
| Known answers in the same record                                                                                                                                                          | Payload digests equal the SHA-256 of the served bodies for a `gzip` body, a plain one, windows-1252, Shift_JIS, UTF-8 with a byte-order mark, and UTF-8 under a windows-1252 label; both redirect hops, same-origin and cross-origin, have a `302` response with no body; the over-limit body and the page's copy of the service worker's answer are `WARC-Truncated`; the cookie the page set and sent appears nowhere in the inflated record; `WARC-IP-Address` 127.0.0.1; `boundTlsAbsent` `not-https`; the Capture verifies | As expected                                                                                                                                                                                                  |
| Stubbed setup failures (same file)                                                                                                                                                        | A frame's failed `Network.enable` moves `unrecordedTargets`; the page's failed `Target.setAutoAttach` makes the page unrecorded; both keep the record                                                                                                                                                                                                                                                                                                                                                                           | As expected: 2 unrecorded for the frame and the worker it starts, 1 for the page                                                                                                                             |
| A page over TLS through the test certificate allowance (same file)                                                                                                                        | `boundTls` states the leaf's subject, alternative names, issuer, and validity; without the allowance the Recapture fails with `ERR_CERT_AUTHORITY_INVALID`                                                                                                                                                                                                                                                                                                                                                                      | As expected                                                                                                                                                                                                  |
| A proxy Egress through the SOCKS5 fixture (same file)                                                                                                                                     | No `WARC-IP-Address`, and neither the record nor the inventory names the proxy's port                                                                                                                                                                                                                                                                                                                                                                                                                                           | As expected                                                                                                                                                                                                  |
| The other Recapture specs (`e2e/recapture.spec.ts`, `recapture-consent.spec.ts`, `recapture-egress.spec.ts`, `recapture-permissions.spec.ts`, `recapture-local-redirect.spec.ts`)         | Pass with the Network domain on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | All passed, in one run with the new spec: 15 of 15                                                                                                                                                           |
| D15's probe, `xvfb-run --auto-servernum node scripts/capture-probe/run.mjs`                                                                                                               | The passes agree on `navigator.webdriver`, the `window.chrome` keys, the `Error.stack` getter count, and the resource timing list; `history.length` 1 off and 2 on                                                                                                                                                                                                                                                                                                                                                              | As expected, exit 0                                                                                                                                                                                          |
| Record sizes (plan, open question 3)                                                                                                                                                      | Reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 33,470 bytes for the fixture page above, the largest; 1,882 to 2,640 bytes for the stub, TLS, and proxy pages; 3,248 to 3,385 bytes for each of the three demo fixture pages (`scripts/demo-fixture/pages/`) |
| The writer at the 50,000,000-byte cap                                                                                                                                                     | Inside its 10 s bound                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Five 7,500,000-byte bodies held as base64: 1,397 ms for random bytes, 37,515,985 bytes written; 410 ms for one repeated byte                                                                                 |

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
  exchange it had to write a response for and had none, and threw. The fix counts a request
  that finished with no response as in flight, so the record keeps a request record for it and
  the Capture keeps its record. D4 defines `inFlight` as a request with neither
  `loadingFinished` nor `loadingFailed`, so this reading widens it, which the maintainer rules on.
- In the same run, the fixture service worker's install handler fetched a file without reading
  its body; that exchange reported its response and data and no `loadingFinished`. Every fixture
  fetch now reads its body, so the counts above do not depend on it.

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

- `inFlight` also counts a request that finished with no response, such as a service worker's
  main script on its own session (Deviations).
- `bodiesOmitted` is one count for a body over the per-resource limit, one the cap left
  unfetched, one the browser no longer held, a text body from a session whose durable messages
  did not answer, and the page's copy of a response its service worker answered.
- `failed` counts a request the consent filter blocked, which arrives with `canceled` false.
- A frame or worker whose setup answered after the 2 s bound counts unrecorded although its
  requests may still be recorded, and its text bodies are left out, since durable messages count
  only when they answered within the bound.

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
  loads `about:blank` before the target. Which of the renderer spike's three options the slice
  takes is the second open decision on #1823; this build keeps `wc.loadURL` and records the
  difference, the plan's fallback.
- The record holds nothing of a resource reused inside the page, of a shared worker's own
  requests, or of what runs below a target whose `Target.setAutoAttach` failed (D17).
- The values of the four credential headers are replaced; a token in a URL, a body, or any other
  header stays in the record (ADR-0036).
- The charset spike measured response bodies only. A request body the browser returns as text
  is stored as its UTF-8 encoding, unmeasured against the bytes sent.
- The manual `warcio check` of ruling 26 did not run: Python `warcio` was not installed. The
  hand-written reader parsed every record the end-to-end spec stored and checked each block and
  payload digest. The check to run is `python3 -m warcio check <capture>.warc.gz` with `warcio`
  1.8.1.
- The end reserve grew from 20 s to 35 s for the two new phases, so within the 120 s Recapture
  timeout the load, the idle waits, and Scroll-to-load share 85 s, where they had 100 s.
- Every fixture is HTTP/1.1 on loopback; no HTTP/2, HTTP/3, or remote server was recorded.

## Acceptance decision

Owed: the maintainer records it here before the release that ships the writers.
