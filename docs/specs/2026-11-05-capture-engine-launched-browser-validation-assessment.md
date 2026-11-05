# Capture engine stage 2: launched-browser validation record

**Date:** 2026-11-05

**Status:** Open. Step 4 of the stage-2 split (#1832) starts this record, in the form of the
[first slice's validation record](2026-10-26-capture-engine-first-slice-validation-assessment.md)
(first-slice plan, D16). Steps 5 and 6 extend it. The maintainer records the acceptance decision
before the release that ships `launched` Captures, and nothing changes it after that.

ADR-0004 requires known-answer validation for an evidence-affecting method, and ADR-0034 makes
each pairing of engine and browser a separate one (stage-2 spec, Validation). Each pairing below
names the browser build, the version `Browser.getVersion` reported, and the items the suite
passed on it.

## Scope

**Step 4 (#1832).** A clicked `launched` Capture of one tab of the browser Birdbrain launched.
The engine records every page target in the default browser context from attach, with
`Network.enable`, `Network.setCacheDisabled`, `Page.enable` on the page, and
`Target.setAutoAttach` sent together before the resume. It replaces credential header values
and removes request bodies in the event handler, before it holds an event. A Capture runs
Scroll-to-load when the Operator asks, waits for network quiet, marks the cut, and takes the
screenshot, MHTML, the page text, the Transaction Record, and the PDF, in that order. `admit`
gains a launched route that signs `method: 'launched'`, `browserProduct`, `browserVersion`, and
`browserFamily`, with the schema 7 inventory values `servedByServiceWorker`,
`requestBodiesWithheld`, and `httpCacheDisabled`. The `captures` row keeps the version in
`browser_version`. On macOS Birdbrain neither launches the browser nor takes a launched Capture
(maintainer ruling of 2026-11-05 on P7).

## Environments

One Linux workstation: kernel 7.2.8 (Omarchy), Node 20.20.2, Electron 45.2.1. The suite runs
under Electron as Node, with sharp built against the system `libvips` (`pnpm build:test-sharp`),
and every browser under `xvfb-run` with no window manager, so no tab ever has focus
(`document.hasFocus()` read `false` on every page). The fixtures are HTTP/1.1 servers on
loopback: one on `127.0.0.1` and, as a second site, the same server reached as `localhost`, one
TLS server whose leaf the suite makes each run and the suite's own launch accepts with
`--ignore-certificate-errors-spki-list`, and the suite's SOCKS5 fixture.

| Pairing | Build | `Browser.getVersion` | Family signed |
| --- | --- | --- | --- |
| Chrome for Testing | `149.0.7827.55`, the pinned build (`scripts/fetch-chrome-for-testing.mjs`, decision D23) | `Chrome/149.0.7827.55` | `chrome-for-testing` |
| Chromium | Arch Linux package `154.0.8037.97`, `/usr/lib/chromium/chromium` | `Chrome/154.0.8037.97` | `chromium` |
| Brave Origin | `155.1.97.59`, `/opt/brave-origin-bin/brave` | `Chrome/155.0.8059.85` | `brave` |

Windows and macOS were not run. Branded Chrome and Microsoft Edge are not installed on this host.

## Expected and observed results

The suite is `tests/main/services/launchedBrowser/captureKnownAnswer.test.ts`. It runs the pinned
build by default; `BIRDBRAIN_SUITE_BROWSER` and `BIRDBRAIN_SUITE_BROWSER_FAMILY` run it against
an installed browser. Every Capture goes through the real Capture Lifecycle into a Case. All 17
items passed on each of the three pairings.

| Item | Expected | Observed on all three pairings |
| --- | --- | --- |
| The start tab | `about:blank` is refused, nothing stored | Refused: "Birdbrain captures `http` and `https` pages only." |
| Typed navigation | Every request the fixture logged before the cut is in the record once; the favicon request is one of them | Equal sets and counts |
| Payload digests | A plain and a `gzip` body equal the fixture's decoded payload | Equal, for `application/octet-stream` bodies (see Deviations, text bodies) |
| The print's own request | Absent from the record, present at the fixture | As expected |
| `warcinfo` | Names the transport, the disabled cache, and the withheld bodies | As expected |
| Signed fields | `method`, `browserProduct`, `browserVersion`, `browserFamily`, schema 7; the row's `browser_version` | As expected |
| Redirect chain | Three request records, two `302` responses and a `200` | As expected |
| Credentials | A fixture cookie, an `Authorization` value and a submitted password appear in no file Birdbrain wrote | None found in the inflated WARC, the inventory, the MHTML, the text, or any file under the suite's root outside the browser's profile |
| Request body | The `POST` holds no body; the inventory counts one withheld | As expected |
| Cache | Every recorded target receives `Network.setCacheDisabled`; a second load of a resource the fixture allows caching reaches it again | As many `Network.setCacheDisabled` as `Network.enable` in the command log; the fixture saw both loads |
| Command log | No `Runtime.enable`, `Log.enable`, `Performance.enable`, `Debugger.enable`, durable messages, cookie readers, or `Network.getRequestPostData` | None sent |
| In flight | A response held open is counted in flight | `inFlight: 1` |
| Two Captures of one navigation | Both stored, each with the same requests | As expected |
| A new navigation | The next Capture holds none of the previous navigation's requests | As expected |
| Cross-site frame | Its document and its fetch are in the record, on its own session | As expected, `unrecordedTargets: 0` |
| Cross-site navigation | Recorded from its first request | As expected |
| `target=_blank` and `window.open` | Each tab has its own record, its document request first, with its opener named in `warcinfo` | As expected |
| A tab behind another | Refused before anything is taken | Refused: "This tab is behind another in its window. Bring it to the front, then capture." |
| Bound TLS Details | Match the TLS fixture's certificate | Subject, issuer, validity and alternative names equal the leaf's |
| Egress | Through the SOCKS5 fixture the entry carries the Egress fields, and the record and inventory hold neither the proxy's address nor any `WARC-IP-Address` | As expected |
| Abandoned Capture | A page that loads another during the artifact commands stores nothing and reports a failed event | As expected |
| Package Verification | An exported package verifies in the app and under the standalone verifier, and a changed byte in its Transaction Record fails both | As expected |

Four items were added after review, and ran on the pinned Chrome for Testing build only. All 21
items passed there; Chromium and Brave Origin were not rerun. The live suite's sink now passes the
committed URL to the exclusion check along with the address at the cut, which unit tests cover.

| Item | Expected | Observed on Chrome for Testing 149 |
| --- | --- | --- |
| Failed and cancelled exchanges | A request the server drops and one the page aborts are each recorded with no response | `failed: 1`, `cancelled: 1` |
| Over the per-resource budget | A 10,000,001-byte response is recorded without its body and counted | An empty payload; `bodiesOmitted` at least 1 |
| Back-forward cache restore | **Back** to a page the browser kept in memory is captured with no Transaction Record | `{ present: false, reason: 'back-forward-cache' }` in the signed entry |
| A new tab | A blank tab opened with `noopener`, then a typed navigation, records every request the fixture logged once | Equal sets and counts. The command list has no `Target.createTarget`, so the suite does not open a tab as Ctrl+T does |

The unit suites cover what the browsers above could not be driven to do with the engine's
command list: a tab whose document request reached no session (`page-not-recorded`, the case of
a Ctrl-click or middle-click tab, probe P4), a crashed tab, a tab
in a private window, the synthetic-event test with a marker in every credential field the spec
lists, the shortcut's choice over injected tab states, and the macOS gate.

### Page-visible effects

Recorded per pairing with every domain the engine enables: `Target` on the browser connection,
`Network`, `Network.setCacheDisabled` and `Page` on each page, `Network` and `Target.setAutoAttach`
on its frames and workers, and isolated-world reads (`Page.createIsolatedWorld`,
`Runtime.evaluate`) for Scroll-to-load, the page text, the title, `document.visibilityState`, and
the shortcut's focus check. The fixture page read its facts every 250 ms before and through a
Capture with Scroll-to-load.

| Fact | Chrome for Testing 149 | Chromium 154 | Brave Origin 155 |
| --- | --- | --- | --- |
| `navigator.webdriver` | `true` | `true` | `true` |
| Keys of `window.chrome` | `app`, `csi`, `loadTimes` | the same | the same |
| Calls to the page's own `Error.prepareStackTrace` for an `Error` passed to `console.debug` | 0 before and after | 0 before and after | 0 before and after |
| Resource timing entries | 10 before, 52 after | 10 before, 52 after | 10 before, 52 after |

The `Error.prepareStackTrace` check is the one the probe kept for P3 (#2053). Its positive
controls cover `Runtime.enable` only, so its silence does not show that a page cannot detect
`Page.enable` or an isolated world. The maintainer ruled on 2026-11-05 that the engine may enable
`Page` and read from isolated worlds on that basis. The resource timing count grows by the
fixture's own reports and the lazy content Scroll-to-load loads; scrolling is visible to the
page through scroll and intersection events (probe P3).

## Deviations

- **Text response bodies are left out.** The first slice keeps a body the browser returns as a
  string only from a session sent `Network.configureDurableMessages`, because on any other
  session the browser can return it decoded from the page's character set (character set
  spike, rulings of 2026-10-26). The 2026-10-17 ruling rules durable messages out of the launched
  browser. The engine therefore keeps only bodies returned as base64, and every text body,
  an HTML document included, is `body-omitted`. The PR asks the maintainer to rule.
- **A tab behind another is refused.** The full-page screenshot with `captureBeyondViewport` of a
  hidden tab did not answer within the 20-second command bound on Chrome for Testing 149, as on
  Chromium 154 in the probe (P2). The engine reads `document.visibilityState` first and refuses
  such a tab with a message. Whether it should bring the tab to the front instead is a question
  for the maintainer.
- **No Image Source Pinning.** ADR-0055 covers background renders only, and a pin edits the page
  the Operator is reading, so a launched Capture pins nothing and its MHTML part records zero for
  both counts. The schema has no form that says the pin did not run.
- **Brave Origin's startup page.** Brave Origin opens its first tab only once its startup page is
  answered. The suite answers it from the page's main world, as the Operator would.
- **The signed product and version.** `Browser.getVersion` reports `Chrome` as the product for
  all three builds, and Brave Origin's Chromium version, `155.0.8059.85`, rather than its own
  `155.1.97.59`. The signed `browserFamily` is what tells the builds apart.
- **Auto-attach on workers.** The engine sends `Target.setAutoAttach` on dedicated and service
  worker sessions, as the spec and the first slice do; the probe measured it on page and iframe
  sessions only. No fixture here starts a worker from a worker.

## False positives and negatives

None observed in the items above. The text-body deviation is a known false negative for the
record's completeness: every such body is counted in `bodiesOmitted`, so the inventory does not
overstate the record.

## Known limitations

- Windows, macOS, branded Chrome and Microsoft Edge were not run.
- The capture shortcut was registered and its choice tested over injected tab states; whether a
  desktop delivers it (P17) was not measured. On Hyprland that means sending key presses into the
  live desktop, which this run did not do.
- A Ctrl-click or middle-click tab, a private window, and a crash were not produced in a live
  browser, because the engine's command list holds no input or context command; the unit suites
  cover the engine's handling of each.
- A shared worker's requests and a page restored from the back-forward cache are as the spec
  describes (its "What the guarantee does not cover").
- The pinned build and the two installed builds ran one pass each for this record.

## Acceptance decision

Owed: the maintainer records it here before the release that ships `launched` Captures.
