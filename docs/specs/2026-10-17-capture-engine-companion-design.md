# Capture engine, stage 3: the Companion pipe and removing extension capture

**Date:** 2026-10-17

**Status:** Design, awaiting approval. Nothing here is implemented. Decisions D1 to D17 are
proposals for the maintainer to rule on, and open questions Q1 to Q4 need an answer before the code
briefs that name them.

**Decisions this rests on:**
[ADR-0034](../adr/0034-the-app-acquires-and-the-extension-is-a-companion.md) (the app is the only
acquirer and the extension becomes the Companion; this stage is the third step of its order of
work), [ADR-0023](../adr/0023-exhibits-are-the-unit-of-evidence.md) (a verifier release learns an
entry shape before any build writes it),
[ADR-0030](../adr/0030-persona-is-a-provenance-axis-beside-operator.md) (Persona),
[ADR-0032](../adr/0032-route-app-egress-but-do-not-disguise-the-browser.md) (Egress),
[ADR-0035](../adr/0035-one-transaction-record-per-capture.md) and
[ADR-0036](../adr/0036-credential-header-values-never-enter-a-transaction-record.md) (the
Transaction Record), [ADR-0002](../adr/0002-tls-capture-corroboration-only.md) as amended, and the
[stage-2 spec](2026-10-10-capture-engine-launched-browser-design.md) with its rulings.

**Brief:** CE-S3 in `docs/plans/2026-10-10-three-programme-agent-briefs.md`, filed as #1900. Ruling
24 of 2026-10-10 folded #635 into this stage and closed it, and closes #1667's extension half in
favor of this stage.

**Audience:** whoever writes the stage-3 code briefs, whoever implements and reviews them, and the
maintainer, who approves the spec and answers its open questions.

**Frame of reference:** code citations name a file and a symbol at `origin/main` `3d9ef9a9`.
Chromium citations name a file and a symbol in `chromium/src` at commit `aee35292`, committed to
`main` on 2026-10-17. Protocol facts come from the `devtools-protocol` package at `0.0.1721318`.
Chrome documentation was read on 2026-10-17, and each citation gives the page's own "Last updated"
date where the page shows one. This spec measured nothing; step 1 of the
[PR split](#proposed-pr-split) measures what it could only read.

## Problem

The Chrome extension acquires every operator-witnessed Capture today. It saves MHTML with
`chrome.pageCapture`, stitches a screenshot from slices of the visible tab, reads the response
headers and status from `chrome.webRequest`, and uploads all of it to the loopback Capture Server.
ADR-0034 ends that arrangement: the app's capture engine is the only acquirer, and "no extension
code decides which bytes become evidence". An ad-hoc Capture in the Operator's everyday Chromium
browser instead goes through a pipe the Companion opens: the Companion attaches `chrome.debugger`
to the tab, the engine takes MHTML, one screenshot of the whole document, and a PDF, and the
Companion detaches. The Capture Method is `companion`.

ADR-0034 does not say how the pipe carries commands, how the app and the Companion know each other,
what is left of the Capture Server once no route takes extension-acquired bytes, what the
`companion` Manifest Entry says, how Captures already written as `extension` keep reading, what the
`debugger` permission costs, or which extension code goes. This spec designs those from three
directions: what the Operator does, what a `companion` Capture has to prove, and what the pipe
exposes on the Operator's machine.

## Prerequisites

1. **The first slice lands first.** A `companion` Capture writes the inventory, the Scroll-to-load
   outcome, the screenshot record, and the PDF that the first slice defines
   ([first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md), D4 to D6, steps 1, 6,
   and 10). This stage adds no second writer and no second inventory shape.
2. **Stage 2 supplies the CDP client.** The maintainer ruled for a client in `src/main` with no
   runtime dependency (stage-2 decision D2), built in stage-2 step 3. The engine drives a
   `companion` Capture with the same client over a second transport.
3. **Stage 2's verifier step supplies the shared absence reason.** "Recording did not cover the
   page" is a stage-2 inventory reason (stage-2 spec, Manifest, schema, and verifier). A
   `companion` Capture is the case where recording never began, and D12 reuses that reason.
4. **CE-3 (#1695) writes `tlsSkipped`.** A `companion` Capture's TLS Cert Chain re-fetch follows
   CE-3's rule, as an `extension` Capture's does.
5. **#1498 carries the Persona fields.** The wording in D13 applies once they exist.

## What exists today

- **The extension acquires.** `manualCaptureTab` in `extension/src/background.ts` opens the
  capture-UI suppression bracket (`captureSuppression.withSuppression`) and collects four things
  at once: MHTML from `captureMhtml` (`chrome.pageCapture.saveAsMHTML`), the tab, the page text
  from `getPlainTextFromTab` (`document.body.innerText` through `chrome.scripting.executeScript`),
  and a screenshot from `captureFullPageScreenshot` or `captureScrollingPageScreenshot`. It refuses
  when the tab's URL changed during collection (#982), then uploads with `sendMhtmlCapture`. The
  ingest branch of `handleSelectionAction` does the same for a Tag or Quote on a page the Case has
  no Capture of. Stopping the Capture Session from the popup while a Capture runs sends
  `STOP_CAPTURE`, which cancels the Capture before its upload starts and only reports it after
  (`cancelledManualCaptures` and `uploadingManualCaptures`).
- **The screenshot is stitched.** `captureFullPage` in `extension/src/content.ts` scrolls one
  viewport at a time, waits 150 ms, asks the background for each slice with
  `REQUEST_VIEWPORT_CAPTURE` (answered by `chrome.tabs.captureVisibleTab`), sets sticky and fixed
  elements to `position: relative` after the first slice (`collectStickyElements`), and draws the
  slices onto an `OffscreenCanvas` under the raw-bitmap budget `MAX_SCREENSHOT_BITMAP_BYTES`
  (`src/shared/constants.ts`). `captureFullPageScrolling` first scrolls for up to 120 seconds to
  load lazy content, then calls `captureFullPage`.
- **Each screenshot path falls back to a lesser one.** `captureScrollingPageScreenshot` falls back
  to `captureFullPageScreenshot`, which falls back to `viewportFallback`, the visible part of an
  active tab only (`captureScreenshot`). Since #1767 the helpers return a `ScreenshotKind`, and
  `screenshotFallbackNote` words a `degraded` toast. The upload carries no field for the kind asked
  for or the kind taken, which is #1667's extension half.
- **Response facts come from `webRequest`.** The `chrome.webRequest.onHeadersReceived` listener
  caches each tab's most recent main-frame headers and status in `responseHeadersByTab`, the
  `chrome.webRequest.onBeforeRequest` listener clears the entry, and `getResponseFactsForCapture`
  hands them to an upload only while the cached URL still matches (`responseFactsForCapture` in
  `extension/src/utils/headers.ts`). The listener asks for `responseHeaders` without
  `extraHeaders`, so Chrome withholds `Cookie` and `Set-Cookie` from it (ADR-0036, Context).
- **The upload is multipart.** `sendMhtmlCapture` in `extension/src/utils/api.ts` posts the URL,
  title, the extension's own timestamp, text, browser version, user agent, extension version,
  status, headers, screenshot, and MHTML to `POST /api/captures`. `buildAttachForm` sends the same
  payload to `/api/tags/apply` and `/api/notes`.
- **The Capture Server ingests it.** The `/api/captures` route in `createApp`
  (`src/main/services/captureServer.ts`) parses `CaptureUploadSchema` (`src/shared/schemas.ts`)
  and calls `captureLifecycle.admit`. `resolveOrIngestCaptureNow` does the same for an attach that
  finds no Capture, and answers 422 when that request carries no MHTML. `admit` in
  `createCaptureLifecycle` (`src/main/services/captureLifecycle.ts`) passes no method, and its
  comment says "the row defaults to 'extension'". `withCaptureEntry`
  (`src/main/services/manifest.ts`) leaves `method` out when it is undefined, so the signed entry
  of an `extension` Capture has no `method` field at all, and `ingestMhtmlCapture` anchors the
  extension's headers and status into that entry.
- **Pairing.** The server binds `127.0.0.1`, refuses a `Host` that is not a loopback literal, and
  requires `X-Birdbrain-Token` on every POST (`createApp`). The `/api/status` handler returns the
  token when a request has no `Origin` or an `Origin` that starts with `chrome-extension://`
  (`includeToken`), and the CORS rule grants every `chrome-extension://` origin, beside
  `http://localhost:` and `http://127.0.0.1:` origins. `SECURITY.md` (Known limitations) records
  the first half: "a local process can obtain it and write captures". The second half hands the
  token to every other extension installed in the Operator's browser, which `SECURITY.md` does not
  list. The options page (`OptionsPage` in `extension/src/options/OptionsApp.tsx`) shows the
  token, and shows the app's `captureScreenshots` setting from `/api/status` beside
  `SCREENSHOT_COPY`, whose text says that "very tall pages fall back to a viewport shot".
- **Auto-capture is commented out.** Six `HOTFIX:` comments in `background.ts` mark the session
  and selector auto-capture paths as disabled, and the app's comments name them (the comment
  above `DEFAULT_DEDUPE_WINDOW_SECONDS` in `src/shared/constants.ts`, the two JSX comments in
  `CapturePreferences` in `src/renderer/components/settings/CapturePreferences.tsx`, one for the
  hidden dedup slider and one for the hidden mode radio, and the `HOTFIX:` comment in
  `src/renderer/components/status/ConnectionStatus.tsx`). `CONTEXT.md` (Capture Session) says the
  everyday browser never captures without a click, so those paths do not return.
- **The extension loads unpacked.** "The extension is not on the Chrome Web Store yet, so it loads
  unpacked in developer mode", and after an app update Chrome keeps running the copy it loaded
  until the Operator reloads it (`website/content/docs/download.mdx`, Load the Chrome extension).
  The app and the extension can therefore run different versions for as long as the Operator
  waits to reload.
- **Capture Methods.** `CAPTURE_METHODS` in `src/shared/types.ts` is `extension`, `background`,
  and `duplicate`. Every reader that meets a missing method reads `extension`: the
  `captures.method` column default (`src/main/services/db/migrations.ts`), `CAPTURE_COLUMNS` and
  the row reader in `src/main/services/db/captureRepo.ts`, `insertExhibitForCapture` in
  `src/main/services/db/exhibitRepo.ts`, the Exhibit index in `src/main/services/reportHtml.ts`,
  and the export in `src/main/services/export.ts`. `CAPTURE_METHOD_LABELS` in
  `src/renderer/components/captures/captureMethodLabel.ts` gives `extension` no label, as "the
  operator-witnessed baseline every other method departs from". The verifier compares a row's
  origin with the entry's method only where the entry states one (`evidencePackage.ts` in
  `src/shared/verify/`). Besides `admit`, four callers of `ingestMhtmlCapture` pass no method and
  so write `extension`: the pipeline self-test route (`CAPTURE_TEST_ROUTE` in
  `captureServer.ts`), which writes into a sandbox it disposes, and the fixture builders in
  `scripts/dev-seed/seed.ts`, `scripts/demo-fixture/build.ts`, and
  `scripts/retrieval-eval/build.ts`.

## What a `companion` Capture proves, and what it does not carry

Each design section names the requirements it serves.

- **C1. The engine chose every command.** The Companion forwards what the engine sends and returns
  what the browser answered. It picks no command and changes no response (ADR-0034, Decision).
- **C2. One document.** All artifacts are of one committed document. A navigation during the
  Capture abandons it.
- **C3. A clean page.** No Birdbrain UI appears in any artifact (#379, #386).
- **C4. Every absence is recorded.** A missing artifact appears in the inventory with its reason;
  nothing falls back silently to a lesser artifact (#1667).
- **C5. The method says where the page loaded.** A `companion` Capture is operator-witnessed, in
  the Operator's everyday browser, after the page loaded, outside the Egress.

What a `companion` Capture never carries, and why:

| Absent | Why |
| --- | --- |
| Transaction Record | The page loaded before the attach. A browser hands over response bodies only to a collector in place before the request, and a reload would be a second observation (ADR-0034, Context and Decision). The inventory says recording did not cover the page (D12) |
| Bound TLS Details | The same: the engine was not attached when the main document's response arrived (ADR-0034, Decision; `CONTEXT.md`, Bound TLS Details). The entry says so with `boundTlsAbsent: 'not-recorded'` (D12) |
| HTTP status and response headers | New in this stage. `extension` Captures anchor the values `webRequest` reported. The engine never saw the response, and keeping the listener would keep an extension API on the evidence path (D12, Q4) |
| An Egress kind | Birdbrain did not route the page: it "still loads in the Operator's own browser, whose network path Birdbrain does not control" (ADR-0032, Consequences) |
| Consent Suppression | Operator-witnessed Captures never carry it (`CONTEXT.md`, Consent Suppression) |
| A Persona Birdbrain checked | Birdbrain does not choose the everyday browser's profile, so a Persona on the entry is the Operator's declaration (ADR-0030; D13) |

And four security requirements:

- **S1.** Nothing but the paired app can make the Companion send a debugger command, and the
  Companion sends only commands on a fixed list (D3, Q1).
- **S2.** Nothing but the paired Companion can open a `companion` Capture (Q1).
- **S3.** No web page can drive the pipe. The DNS-rebinding guard, the CORS rule, and the token
  check in `createApp` stay in front of it.
- **S4.** The relay never asks the browser for a cookie value (D3).

## The Operator's workflow

**Before the first Capture.** After an app update the Operator reloads the Companion at
`chrome://extensions`, as `download.mdx` already asks. The Companion now holds the `debugger`
permission, whose warning includes "Access the page debugger backend" (see
[The `debugger` permission](#the-debugger-permission)). Whether Chrome shows that warning when an
unpacked copy is reloaded is probe question P10. If the maintainer answers Q1 with option (b), the
Operator pairs the Companion with the app once.

**Taking a Capture.** The Operator starts a Capture as today: the popup's Capture button, the
context menu's "Capture Full Page" and "Capture Full Page (Scrolling)" items, the capture card's
recapture action, or a Tag or Quote from the selection bar on a page the Active Case has no Capture
of. The second menu item asks for Scroll-to-load, and the card's recapture repeats the choice of
the Capture it came from. Chrome shows `"Birdbrain Capture" started debugging this browser` in
every window while the Capture runs and for about five seconds after it, with a **Cancel** button
that abandons the Capture. Stopping the Capture Session from the popup abandons a Capture whose
artifacts the engine has not yet handed to `admit`, as `STOP_CAPTURE` does today. The toast
reports progress, then the capture card it shows today, and names any artifact the Capture lacks.

**What changes for the Operator.** The engine's screenshot does not read the visible tab, so the
tab may not need to be in front (P12). A Capture no longer settles for a lesser screenshot without
saying so in the signed record. The Capture records no HTTP status (Q4). A Capture of a page Chrome
will not let an extension debug, such as another extension's page, fails with a message instead of
falling back. An infobar sits above the page: the stage-2 probe saw Chrome for Testing's own
infobar shorten the viewport by 56 pixels (probe P19), so the captured page probably lays out at a
shorter viewport while the debugging infobar shows, which P5 measures.

## Design

### The pipe

Serves C1, S1, S2, S3.

**D1. The Companion relays and the engine decides.** The engine's CDP client (stage-2 decision
D2) gains a second transport, the Companion relay. Each `companion` Capture is one relay session
for one tab. The engine sends a command, the Companion calls `chrome.debugger.sendCommand` on the
tab with that method and those parameters, and the Companion returns the result or the error as
the browser gave it. The Companion forwards the events of any domain the engine enabled with its
next message. It holds no artifact logic: no screenshot arithmetic, no script of its own, no
choice of command.

**D2. Transport: request and response round trips on the existing Capture Server.** The Companion
opens a session with one POST and then sends one POST per step: the results of the previous
commands, and any events. Each answer from the server carries the engine's next commands, or the
outcome. Because the Companion starts every `companion` Capture, the engine never needs to push.
This spec weighed three transports:

| | A. HTTP round trips (proposed) | B. WebSocket on loopback | C. Native Messaging |
| --- | --- | --- | --- |
| New permission | None | None | `nativeMessaging`, warning "Communicate with cooperating native applications" ([permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list), last updated 2026-09-09) |
| New dependency | None; `hono` and `@hono/node-server` serve it today | A WebSocket server: `ws` or a hand-written RFC 6455 server, since `package.json` has neither | A host program that Chrome starts, and a second channel from it to the running app |
| Service worker lifetime | A `fetch` alone does not reset the idle timer, but each round trip also calls `chrome.debugger.sendCommand`, and since Chrome 110 "Extension API calls reset the timers"; since Chrome 118 "Active debugger sessions created using the browser.debugger API now keep the service worker alive" ([service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), last updated 2023-05-02) | Since Chrome 116 messages across a WebSocket reset the idle timer (same page) | Since Chrome 105 an open native port keeps the worker alive (same page) |
| Message size | The server's 250 MB body limit (`bodyLimit` in `createApp`), above the 200 MB `MAX_MHTML_SIZE` (`src/shared/constants.ts`) | Set by the server | "The maximum size of a single message from the native messaging host is 1 MB" and "The maximum size of the message sent to the native messaging host is 64 MiB" ([native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), last updated 2026-09-16) |
| Setup per browser | None | None | A host manifest per product and platform; the page documents Chrome, Chrome for Testing, and Chromium paths, and a registry key on Windows |
| Who can connect | Any local process holding the token, until Q1 changes that | The same | Only extensions in the host's `allowed_origins`, which "can't contain wildcards" (same page) |

Option A adds nothing to install, permit, or register, and its one weakness, who may connect, is
the question Q1 asks of every option. A WebSocket buys push messages, which a Companion-initiated
Capture does not need. Native Messaging has the strongest caller check, at the cost of a new
permission warning, a host program, a host manifest for each browser product, and a 64 MiB limit
on each message to the host, which an MHTML under today's 200 MB cap can exceed. It stays the
fallback if Q1's pairing proves weak.

**D3. The Companion relays only a fixed list.** Whatever answers on the port, the Companion
refuses any command outside a constant list and any `Runtime.evaluate` expression outside a
constant list of scripts, which it matches by SHA-256. Both lists live in one `src/shared` module
that the engine and the Companion import, as the extension already imports `@shared/urlPatterns`.
The proposed command list, each present in `devtools-protocol` `0.0.1721318`:

- `Page.getFrameTree`, `Page.createIsolatedWorld`, and `Runtime.evaluate` in that isolated world's
  context only;
- `Page.getNavigationHistory`, for the URL and title;
- `Page.getLayoutMetrics` and `Page.captureScreenshot`;
- `Page.captureSnapshot` (experimental), for MHTML;
- `Page.printToPDF`, and `IO.read` and `IO.close` if the PDF arrives as a stream;
- `Network.enable` and `Network.disable` only if probe question P8 shows the engine needs them to
  wait for lazy loads, and that the page cannot tell.

The scripts are the page-text read, the Scroll-to-load step and reset scripts, and the Birdbrain-UI
check of D6. Each is a constant string: the background renderer's reset script takes the
overflow values the unlock script lifted (`scrollResetScript` in `backgroundRenderer.ts`), and with
no unlock (D9) it is always the script `scrollResetScript(null)` builds. The Companion also checks
that every `Runtime.evaluate` names the `contextId` that its own `Page.createIsolatedWorld` call
returned in this session, so no listed script runs in the page's main world. The list excludes
every command that returns cookie values (`Network.getCookies`, `Network.getAllCookies`,
`Storage.getCookies`), every command that navigates, types, or clicks, and `Runtime.enable`,
`Debugger.enable`, and `Log.enable`, as stage 2 excludes them (stage-2 spec, The CDP client).
`chrome.debugger` offers no `Browser` domain: its documented domains are "Accessibility, Audits,
CacheStorage, Console, CSS, Database, Debugger, DOM, DOMDebugger, DOMSnapshot, Emulation, Fetch,
IO, Input, Inspector, Log, Network, Overlay, Page, Performance, Runtime, Storage, Target, Tracing,
WebAudio, and WebAuthn"
([`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger), last
updated 2026-10-05). If authentication fails, this list still holds: a process that takes the
port can at worst ask for the artifacts of a Capture the Operator started.

**D4. Both sides state a protocol version.** `/api/status` gains a Companion protocol number, and
the session-opening request carries the Companion's own. A mismatch refuses the Capture before any
attach, and the popup asks the Operator to reload the extension at `chrome://extensions`. An
unpacked Companion and the app drift apart after every update until the Operator reloads, so the
first post-stage-3 app meets old extensions often; without the check, an old extension posts to a
route that no longer exists and reports "Capture failed".

**Authentication** is open question Q1.

### Admission

Serves C5.

**D5. The engine admits before the attach, and `admit` checks again at ingest.** The
session-opening request names the Active Case, the tab's URL as the Companion reads it, whether
Scroll-to-load is asked for, and any attach intent (D10). Before it asks for the attach, the
Capture Lifecycle checks the operator name, the Case, and the exclusion policy (`matchCaseExclusion`
in `src/main/services/exclusionPolicy.ts`), and applies the manual dedup window
(`MANUAL_DEDUPE_WINDOW_MS`) to a clicked Capture and not to capture-then-attach, as `admit` does
for the `manual` and `attach` routes today. A refused Capture never shows the infobar. `admit`
today runs those checks and the ingest in one call, so the lifecycle gains a check that runs the
policy without ingesting. `admit` checks the operator name, the Case, and the exclusion policy
again against the URL the engine read at the cut, as stage 2 checks passive pages twice (stage-2
spec, Selector matching and passive capture). The dedup window runs once, at the first check: it
records the time it admits, so a second pass would refuse the Capture it had just let through.
The Companion's own pre-check, `blockedCaptureReason` in `background.ts`, stays as a courtesy; the
server stays the enforcement point. Keeping the policy in the Capture Lifecycle keeps the Capture
Server transport only (`CONTEXT.md`, Capture Server).

### Keeping Birdbrain's own UI out of the artifacts

Serves C3.

**D6. The suppression bracket stays in the Companion, and the engine checks its result.** The
Companion still injects selector highlights, the toast, the selection bar, and the capture card
into the Operator's pages (ADR-0034 keeps highlights in the Companion). `createCaptureSuppression`
(`extension/src/captureSuppression.ts`) keeps its contract: strip before the first artifact, hold
while the engine collects, restore after, on the failure path too. It opens before the attach
and closes after the detach. The engine does not take the Companion's word for the result: before
the first artifact command and after the last, it runs one listed script in its isolated world
that counts the nodes `removeInjectedBirdbrainUi` (`extension/src/captureHygiene.ts`) removes. A
count above zero abandons the Capture, which keeps #386's rule that a page that cannot be shown
clean is not stored. The count uses that function's selectors, and its own comment says a
page-owned `div` whose id starts `birdbrain-styles-` matches one of them. On such a page, after a
strip by the content script, the count finds the page's own element and the Capture is abandoned;
after the fallback strip in `prepareTabForCapture`, the element is gone from the evidence, as it is
today.

This puts Companion code on the evidence path in one place: it removes its own nodes from the
DOM before the engine reads it. It removes only what it injected, and the engine verifies the
outcome, so this spec reads it as consistent with "no extension code decides which bytes become
evidence".

### The `companion` Capture sequence

Serves C1 to C4.

**D7.** For a `companion` Capture of tab T:

1. The Companion opens the session (D4, D5), opens the suppression bracket (D6), and calls
   `chrome.debugger.attach` on T. An attach that fails ends the session with Chrome's error.
2. The engine reads the frame tree and creates an isolated world.
3. If the Operator asked for it, the engine runs Scroll-to-load (D9).
4. The engine waits for the page to settle, bounded by the background renderer's `NETWORK_IDLE_MS`
   and `INITIAL_NETWORK_IDLE_MAX_MS` (`src/main/services/backgroundRenderer.ts`). The renderer
   counts requests through the Electron session's `webRequest` (`createNetworkIdleTracker`), which
   the everyday browser does not give the engine, so P8 decides whether that wait needs `Network`.
5. The engine marks the cut: it reads the URL and title with `Page.getNavigationHistory`, runs the
   UI check (D6), and takes the timestamp from the main process's clock. The extension's clock no
   longer reaches the signed entry. A URL that differs from the admitted one, compared with
   `canonicalizeUrl` (`src/shared/urlCanonicalize.ts`), abandons the Capture, as
   `manualCaptureTab` refuses today (#982).
6. The engine takes the screenshot (D8).
7. The engine takes MHTML with `Page.captureSnapshot`.
8. The engine reads the page text in the isolated world.
9. The engine takes the PDF with `Page.printToPDF`, last, because printing fires `beforeprint` and
   starts requests (stage-2 spec, The Capture sequence).
10. The engine reads the URL again and reruns the UI check. A changed URL or a Birdbrain node
    abandons the Capture.
11. The engine hands everything to `admit` with `method: 'companion'`, a field `admit` gains
    (D14). The Companion detaches in a `finally`, closes the bracket, and shows the outcome.

The order follows stage 2 without the Transaction Record. A failed MHTML command abandons the
Capture, because MHTML carries the Content Hash. A failed screenshot or PDF keeps the Capture with
that artifact absent as `failed`, as ruling 29 keeps a `background` Capture whose print fails. An
abandoned Capture writes nothing: no file, no row, no Manifest Entry. A stop from the popup
abandons the Capture up to step 11; once the engine has handed the artifacts to `admit`, the
Companion answers as `STOP_CAPTURE` does today for an upload in progress.

Every request the sequence causes, the lazy loads of Scroll-to-load and the print-only resources of
the PDF, leaves from the Operator's browser outside the Egress, as the page itself did. ADR-0032
already treats that browser as outside the Egress (Consequences) and warns about it when a Capture
Session starts (warning rule 3). A `companion` Capture needs no running Capture Session, as a
manual Capture needs none today, so that warning may not have shown; the requests the sequence
adds are of the same kind as the page's own.

### The screenshot

Serves C4. Folds in #635.

**D8. One screenshot, or a recorded absence.** The engine takes one `Page.captureScreenshot` with
`captureBeyondViewport` over the content box from `Page.getLayoutMetrics`, with the caps, the trim,
and the screenshot record of the first slice: `MAX_CAPTURE_DIMENSION_PX` and `MAX_CAPTURE_PIXELS`
in `backgroundRenderer.ts`, `trimTrailingBackground`, and the `scaled`, `truncated`, and `trimmed`
facts of first-slice plan D6. The width is the Operator's window width, as in a launched browser.
Nothing falls back to a viewport shot or a stitch.

- **Above the caps the screenshot is truncated, and the record says so.** This answers #635's open
  choice the way the background path already does. The MHTML and the Extracted Text keep the whole
  page, and a recorded `truncated: true` shows a reviewer where the image stops. The stitcher that
  went past the caps is the code this stage deletes (ADR-0034, Consequences: "the stitcher goes").
- **The caps may need the device pixel ratio.** The background renderer's arithmetic works in CSS
  pixels in a window it controls. Whether `Page.captureScreenshot` returns device pixels on the
  Operator's display, so that the caps need the ratio, is probe question P4.
- **The screenshot can be absent.** First-slice plan D4 writes the screenshot part as always
  present, because a failed screenshot fails a `background` render. A `companion` Capture keeps
  its MHTML when the screenshot fails, so the screenshot part gains an absent form (D17).
- **The `captureScreenshots` setting still governs.** Today only the extension honors it, through
  `/api/status`. The engine reads it, and a screenshot it turns off is absent with a reason the
  verifier step adds, proposed as `turned-off`, because first-slice plan D4 defines `not-taken` as
  "this build does not take the file".
- **The upload cap still applies.** `readScreenshot` in `captureLifecycle.ts` drops a screenshot
  above `MAX_SCREENSHOT_SIZE` (100 MB) and reports it to the toast without a record. The pixel
  caps bound the image, and the comment above `MAX_SCREENSHOT_BITMAP_BYTES` puts a bitmap of about
  25 megapixels at single-digit megabytes as PNG, so an engine screenshot rarely nears the cap. One
  that exceeds it is absent as `failed`, so the inventory says so.
- **#635's failure list becomes checks for the replacement** (see [Validation](#validation)): the
  clamped final slice (#610), seam drift at fractional device pixel ratios, sticky and fixed
  headers, the 150 ms settle window and its suppression contract (#386), and canvas size limits.

### Scroll-to-load

Serves C4.

**D9. Scroll-to-load runs in the engine and fails closed.** The engine runs the background
renderer's step and reset scripts through `Runtime.evaluate` in the isolated world, as stage 2
does, and records CE-8's `scrollToLoad` outcome (first-slice plan D5). A Capture without the
scrolling menu item records `requested: false` and `ran: false`, a value the first slice's shape
does not admit, because the background renderer always requests the phase (D17). A scroll step
that throws abandons the Capture, and the toast says why, as a throwing step fails a `background`
render today (`CONTEXT.md`, Scroll-to-load), so the outcome list stays closed and needs no `failed`
value. The overflow unlock
(`SCROLL_UNLOCK_SCRIPT`) does not run: it is a style edit the page can see, and the Operator is
present to dismiss a consent wall, as the stage-2 spec decides for launched browsers (The Capture
sequence, step 2). `scrollLockLifted` is therefore always false. The phase keeps the extension's
120-second ceiling (`scrollTimeoutMs` in `captureScrollingPageScreenshot`), not the renderer's
75-second `MAX_SCROLL_PHASE_MS`, so a scrolling Capture gives lazy content as long as it does
today; each step is its own round trip, so no single call outlasts the service worker's limits
(P7). Because the renderer derives `MAX_SCROLL_CONTENT_HEIGHT_PX` from its 1,280-pixel viewport,
the engine derives the height cap from the Operator's window width instead, so the cap still
matches the pixel budget of D8.

### Capture-then-attach

Serves C2, and keeps #392's ordering.

**D10. Capture-then-attach stays one server operation.** When a Tag or Quote targets a page the
Active Case has no Capture of, the Companion opens a `companion` session whose request names the
Tag or the Note. The server runs it inside the per-URL chain that `resolveOrIngestCapture` keeps
today, ingests, and only then applies the Tag or creates the Note. A failed Capture refuses with no
attach, a Capture whose attach then fails answers with its `captureId` and `captured: true`, and
two concurrent requests for one URL the Case has no Capture of wait on each other instead of
capturing twice (PR #835 review). `/api/tags/apply` and `/api/notes` keep attaching to an existing
Capture and lose their payload fields.

### What remains of the Capture Server

Serves S3.

**D11.** The route table after this stage:

| Route | After stage 3 | Who uses it |
| --- | --- | --- |
| `GET /api/status` | Stays. Gains the protocol number (D4). Drops `autoCaptureMode` and `dedupeWindowSeconds`, which only the extension's `HOTFIX:` comments read. Keeps `captureScreenshots`, which the options page shows (`screenshotPill` in `OptionsApp.tsx`) and which now says whether a `companion` Capture takes a screenshot. Under Q1 option (b) it stops returning the token | Companion background, popup, and options page |
| `GET /api/cases`, `POST /api/cases/:id/activate` | Stay | Popup: choosing the Active Case |
| `POST /api/session/start`, `POST /api/session/stop` | Stay | Popup stops a Capture Session; the app starts one over IPC, and only `e2e/capture-server-api.spec.ts` posts to the start route |
| `GET /api/selectors/active`, `POST /api/selectors` | Stay | Highlights; a Selector from selected text |
| `POST /api/captures/lookup`, `/api/captures/card`, `/api/captures/card/tag` | Stay | Popup page status; the capture card |
| `POST /api/tags/apply`, `POST /api/notes` | Attach to an existing Capture only (D10) | Selection bar |
| `POST /api/captures/test` | Stays. It is the app's own self-test, which `src/main/ipcHandlers.ts` calls; it writes into a sandbox and acquires nothing | The app |
| `POST /api/captures` | Removed | Nothing once the Companion stops uploading |
| Relay session routes | New: open, step, and close (D2) | Companion background |

The Active Case, Tags, Selectors, and highlights need nothing new. Each relay route sits behind the
same DNS-rebinding guard, CORS rule, and authentication as every other route. `CONTEXT.md` changes
its Capture Server entry ("that the Chrome extension posts captures to") with the code. The options
page's `SCREENSHOT_COPY`, which describes the stitcher and the viewport fallback, is rewritten in
the same step as the code it describes.

### The `companion` Manifest Entry

Serves C4, C5.

**D12.** The `capture` entry of a `companion` Capture carries:

- `method: 'companion'`, always written;
- `contentHash` for the MHTML, and `screenshotHash`, `textHash`, and the first slice's `pdfHash`
  when each artifact is present;
- the first slice's inventory (first-slice plan D4): MHTML present; the Transaction Record absent
  for the stage-2 reason "recording did not cover the page", because it is the same fact as in a
  launched browser, the engine was not attached before the document request; the screenshot
  record of D8, or the screenshot absent with its reason; and the PDF present with
  `afterCollection: true`, or absent as `failed`. The first slice defines `afterCollection` as the
  PDF "printed after collection stopped"; a `companion` Capture collects nothing and prints after
  every other artifact, so `true` stays accurate and the PDF part needs no new value;
- `boundTlsAbsent: 'not-recorded'`, the first slice's value "when the Capture has no Transaction
  Record" (first-slice plan D7). A Duplicate writes neither `boundTls` nor `boundTlsAbsent`
  (first-slice plan D11), because it observed nothing; a `companion` Capture observed the page and
  writes why it holds no Bound TLS Details;
- the Scroll-to-load outcome (D9);
- the TLS Cert Chain re-fetch (ADR-0002) while the Egress is Direct, and `tlsSkipped` otherwise,
  as for `extension` Captures, which the schema already allows without an Egress kind ("an
  extension capture's page loads in the Operator's own browser", the refine comment on
  `ManifestCaptureEntrySchema`);
- the Persona fields of #1498, as the Operator declares them.

It omits `headers`, `httpStatus`, `finalUrl`, `egressKind`, `egressLabel`, and `userAgent`, which
the schema already lets an entry omit: `userAgent` is "the string the render sent" (the comment on
the schema-5 fields), and Birdbrain set no user agent on a page that loaded in the Operator's
browser. The row keeps the Companion's version as `extensionVersion`, and the browser version and
user agent the Companion reports when it opens the session, unsigned, as `extension` rows keep
them today. The stage-2 browser identity fields (stage-2 decision D12) stay off the entry: they
sign what `Browser.getVersion` reported to the engine, which `chrome.debugger` cannot send, and one
signed field cannot mean both "the engine asked the browser" and "the extension said". Losing the
status and headers changes what ADR-0034's consequences describe; Q4 asks whether to amend them.

### Wording

Serves C5. Stage 2 left the `companion` wording to this stage (stage-2 spec, Persona wording).

**D13.** The proposed strings:

| Surface | `companion` |
| --- | --- |
| Capture detail label (`CAPTURE_METHOD_LABELS`) | Companion |
| `report.html` method and the Exhibit index | companion |
| `report.html`, `certification.html`, `VERIFY.md`: what the method means | Taken through the Birdbrain Companion in the Operator's own browser, after the page had loaded. Operator-witnessed. Holds no Transaction Record and no Bound TLS Details, records no HTTP status (under Q4's recommendation), and the page was not sent through the Egress |
| Persona, when one is recorded | persona declared by operator |

The Persona wording is the `extension` wording (stage-2 decision D11), because in both cases
Birdbrain chose no profile and the stamp is the Operator's claim. The `extension` label and wording
stay as they are on every surface. `extension` keeps no Capture Detail label, which now marks a
legacy Capture rather than a baseline; the comment on `CAPTURE_METHOD_LABELS` changes to say so.

### The legacy `extension` value

Serves C5.

**D14. Old Captures keep reading as `extension`, and no new acquisition writes it.**

- **Reading.** `CAPTURE_METHODS` keeps `extension`, and the signed-entry schema keeps accepting a
  `capture` entry with no `method`. Every default listed under
  [What exists today](#what-exists-today) stays, because it is how entries written without a
  method read. The verifier's origin check keeps skipping an entry without one.
- **Writing.** From this stage every new Capture states its method. The method parameter of
  `ingestMhtmlCapture` becomes required and its type excludes `extension`, so a new path that
  forgets the method fails `pnpm typecheck` instead of inheriting the default. `admit` gains the
  same required field, which the relay passes as `companion`. The pipeline self-test passes
  `companion`, because it exercises the ingest a clicked Capture uses and its sandbox is disposed
  after the request. The three fixture builders under `scripts/` pass `companion` too: they stand
  in for the Operator's own Captures, and `companion` is the method a new one has. Their Cases then
  show the Companion label on Capture detail. The only code that still writes `extension` copies a
  row that already holds it: the Case Archive import, a Shared Case member receiving a teammate's
  Capture, and the migrations that backfill old rows. The `admit` case in
  `tests/main/services/captureLifecycle.test.ts` that expects `row.method` to be `extension` moves
  to `companion`; the attach-route case in `tests/main/services/captureServer.test.ts` that pins
  the same default ("Operator-witnessed, honestly (R2)") goes with the payload cases of the
  [deletion list](#the-deletion-list); and the Case Archive round trip
  (`tests/main/services/caseArchiveRoundTrip.test.ts`) keeps reading an `extension` row. A
  Duplicate of an `extension` Capture is `duplicate`, and a Recapture of one is `background`, as
  today.
- **Not the same value.** The Selector origin `extension` (`SELECTOR_ORIGINS` in
  `src/shared/types.ts`) names the surface a Selector came from, and the Companion keeps writing
  it; it is not a Capture Method.

### The `debugger` permission

Serves S1. ADR-0034 lists the infobar, the install warning, and Chrome Web Store review as
consequences; this section gives the sources.

**The install warning.** For `debugger`, the permissions list gives two warnings: "Access the page
debugger backend." and "Read and change all your data on all websites."
([permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list), last
updated 2026-09-09). The second already shows today, because the same page gives it for
`pageCapture`, which the manifest holds, so only the first line is new.

**It cannot be optional.** The permissions API lists `"debugger"` among the "Permissions that can
not be specified as optional"
([`chrome.permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions), last
updated 2026-09-11), so the Companion cannot ask for it at the first `companion` Capture. For an
installed extension, "When a new permission that triggers a warning is added, the extension will be
disabled until the user accepts the new permission"
([permission warning guidelines](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings),
last updated 2024-02-05). The same page's ways to view an extension's warnings both install a
packed copy, through the Extension Update Testing Tool or Pack Extension at `chrome://extensions`,
and it says nothing about loading or reloading an unpacked one. The Companion loads unpacked today
(`download.mdx`), so what the Operator sees when a reload adds `debugger` is probe question P10.

**The infobar.** Chromium's source, at `aee35292`:

- `ExtensionDevToolsClientHost::Attach` in
  `chrome/browser/extensions/api/debugger/debugger_api.cc` shows the warning on every attach unless
  Chrome runs with `--silent-debugger-extension-api` or an enterprise policy installed the extension
  ("We allow policy-installed extensions to circumvent the normal infobar warning").
- `ExtensionDevToolsClientHost::CreateWarningInfobar` in the same file takes one of two paths,
  and both show the infobar in every window, not only the captured tab's:
  `ExtensionDevToolsInfoBarController::OnClientHostAttached` calls `ShowGlobally`, and the older
  path in `extension_dev_tools_infobar_delegate.cc` creates a `GlobalConfirmInfoBar`.
- The label is `IDS_DEV_TOOLS_INFOBAR_LABEL` in `chrome/app/generated_resources.grd`: "<extension
  name>" started debugging this browser. The extension name is the manifest's `name`, "Birdbrain
  Capture" today.
- When the last session detaches, both paths wait `kAutoCloseDelay`, `base::Seconds(5)` in
  `extension_dev_tools_infobar_delegate.h`, before they hide the infobar
  (`ExtensionDevToolsInfoBarController::OnClientHostDetached`, and
  `ExtensionDevToolsInfoBarDelegate::MaybeStartAutocloseTimer`). The string's own description in
  the `.grd` file still says the label "does not disappear until the user dismisses it", which the
  code no longer does.
- The infobar's only button is **Cancel**. Pressing it reaches
  `ExtensionDevToolsClientHost::WarningUiDestroyed` for every attached session, which sets the
  detach reason `canceled_by_user`, answers each pending command as detached
  (`RespondDetachedToPendingRequests`), and closes the session.

The infobar therefore shows in every window from the attach until about five seconds after the
detach. ADR-0034 says it shows "for the length of one Capture"; Q3 asks whether to correct that
wording. An infobar sits above the page, so it probably shortens the viewport of the tab being
captured while it shows; the stage-2 probe saw Chrome for Testing's own infobar do that, by 56
pixels (probe P19). P5 measures it for the debugging infobar.

**Where Chrome refuses the attach.** `ExtensionMayAttachToURL` in `debugger_api.cc` refuses
another extension's pages, `file:` pages without file access, and URLs the extension's
permissions data treats as restricted; a comment there notes that "The `debugger` permission
implies all URLs access (and indicates such to the user)". The API reference adds two enterprise
policies: blocked hosts in `ExtensionSettings`, which block the attach "on all targets", and
`DisableScreenshots` or Data Loss Prevention rules, which fail it with "Screenshot capture is
restricted by policy." ([`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger)).
The same reference says the session ends "when either the tab is being closed or Chrome DevTools is
being invoked for the attached tab". Each of these is a failure row below.

**Chrome Web Store review.** The Companion is not on the store today. When it is, the review
process names "dangerous permission requests" among the signals that "may cause the reviewer to
examine an extension more closely", and says "Reviews may take longer for extensions that request
broad host permissions or sensitive execution permissions"; its examples of broad host permissions
include `https://*/*`, which the manifest already holds, and its examples of sensitive execution
permissions include `webRequest`
([review process](https://developer.chrome.com/docs/webstore/review-process), last updated
2021-12-10). The page does not name `debugger`. Removing `pageCapture` and `webRequest` narrows
what review has to justify, and `debugger` adds a permission whose warning says it can read and
change all data on all websites. The Microsoft Edge Add-ons store is not covered here.

### The extension manifest

**D15.** `extension/manifest.json` adds `debugger` and removes `pageCapture` and `webRequest`. It
adds `"minimum_chrome_version": "118"`, the release from which an attached debugger keeps the
service worker alive (D2); the key sets the oldest Chrome that can install the extension
([`minimum_chrome_version`](https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version),
last updated 2024-04-26). `scripting` stays for the fallback strip in `prepareTabForCapture`, and
`activeTab`, `tabs`, `storage`, `contextMenus`, `alarms`, the host permissions, and the
`connect-src` of the content security policy stay. The manifest stays at `manifest_version` 3.

### Closing #1667's extension half

**D16.** #1667's extension half is "the signed record does not say that a scrolling capture fell
back to a lesser screenshot". This stage removes the fallback instead of recording it: a
`companion` Capture has one screenshot path (D8), its Scroll-to-load records whether it was asked
for, whether it ran, and how it ended (D9), a scroll step that throws abandons the Capture, and a
failed screenshot is a recorded absence. Step 5 of the split meets the half, and its pull request
says "Refs #1667", because ruling 24 closes the issue when CE-P step 6 records the background
half, which may come first. The fallback toast that #1767 added goes with the helpers it reports
on.

### Manifest schema and verifier

**D17. A verifier release learns `companion` before any build writes it.** First-slice plan D2
admits in each new field only the values the first slice can write, so this stage needs a schema
step for each value it adds:

- `CAPTURE_METHODS` gains `companion`;
- the inventory's screenshot part gains an absent form, with the first slice's `failed` and the
  proposed `turned-off` for the setting (D8), and the first slice's third refine "When `inventory`
  is present, `screenshotHash` is present" (first-slice plan D2) becomes "`screenshotHash` is
  present exactly when `inventory.screenshot.present` is true", which every entry the first slice
  writes already meets;
- `scrollToLoad.requested` admits `false` (D9);
- the Transaction Record part admits the stage-2 reason "recording did not cover the page".

`boundTlsAbsent: 'not-recorded'` and the PDF part need no change. The stage-2 spec lists "tab not
visible" among its inventory reasons, so the stage-2 verifier step may already give the screenshot
an absent form, and a launched Capture without Scroll-to-load needs `requested: false` too; this
step adds whatever that step did not. A refine requires the next schema version on an entry that
carries any of these values, and `fieldMinReaderSchemaVersion` in `manifest.ts` stamps that
version, so an older verifier reports itself too old instead of reporting a broken chain, as the
Egress fields require schema 5 (`ManifestCaptureEntrySchema`). The release ships before the writer
(step 5 of the split) merges, and its release notes tell Shared Case members to upgrade together.

The step also checks the Case Archive. When #827 added `duplicate`, an older Birdbrain's strict
enum read a valid archive as failed verification, and the archive version moved to 5 (comment
above `CASE_ARCHIVE_SCHEMA_VERSION` in `src/main/services/caseArchive.ts`). At `3d9ef9a9`,
`inspectCaseArchive` reports a chain entry stamped above its schema as `verifierTooOld`, and
`ImportCaseDialog` (`src/renderer/components/dashboard/cases/ImportCaseDialog.tsx`) then offers no
import, override included, so a build with that path needs no archive bump. The step checks that
every release a Shared Case member may still run has that path; if one does not, the step takes the
Case Archive lane for one bump. The `captures.method` column is plain `TEXT`, so no migration is
needed. Whether the stage-2 verifier step carries `companion` is Q2.

## The deletion list

Each row names what goes at `3d9ef9a9`, the step of the [PR split](#proposed-pr-split) that removes
it, and the tests that go or change with it.

| Item | Code that goes | Step | Tests |
| --- | --- | --- | --- |
| Scroll-and-stitch screenshot | `extension/src/content.ts`: `captureFullPage`, `captureFullPageScrolling`, `collectStickyElements`, `restoreStickyElements`, `STICKY_FIXED_SELECTORS`, `StickyEntry`, `SCROLL_TIMEOUT_MS`, `SCROLL_PAUSE_MS`, `SCROLL_STALL_THRESHOLD`, `captureInProgress`, `createImageBitmapFromDataUrl`, `blobToDataUrl`, `captureFailureResponse`, and the `CAPTURE_FULL_PAGE` and `CAPTURE_FULL_PAGE_SCROLLING` message branches. `extension/src/captureSuppression.ts`: `suppressCaptureUiOrThrow`, whose only callers are `captureFullPage` and `captureFullPageScrolling`. `src/shared/constants.ts`: `MAX_SCREENSHOT_BITMAP_BYTES`, which only the stitcher and the two background helpers read | 5 | `tests/extension/fullPageStitch.test.ts` goes; the "screenshot paths suppress before any frame (#386)" block of `tests/extension/prepareForCapture.test.ts` goes, and its "PREPARE_FOR_CAPTURE (#379)" block stays; in `tests/extension/captureSuppression.test.ts` the two `suppressCaptureUiOrThrow` cases of the "capture UI teardown registry" block go |
| Background screenshot paths and their fallbacks | `extension/src/background.ts`: `captureScreenshot`, `ScreenshotKind`, `ScreenshotResult`, `SCREENSHOT_KIND_RANK`, `PRODUCED_SCREENSHOT_NOTE`, `screenshotFallbackNote`, `viewportFallback`, `captureFullPageScreenshot`, `captureScrollingPageScreenshot`, `pageNotCleanError`, the `REQUEST_VIEWPORT_CAPTURE` branch of the `chrome.runtime.onMessage` listener, `captureScreenshotsEnabled`, and the `fallbackNote` parameter of `attachDetail` | 5 | `tests/extension/backgroundScreenshotSuppression.test.ts` goes, both blocks; its #386 cases are rewritten against the bracket around a relay session |
| MHTML and text read by the extension | `background.ts`: `captureMhtml` and `getPlainTextFromTab` | 5 | The `pageCapture` stubs in the extension tests' `chrome` mocks, and the `scripting.executeScript` answers that stand in for the page text; the `executeScript` stub that the fallback strip in `prepareTabForCapture` uses stays |
| `webRequest` header code | `background.ts`: `responseHeadersByTab`, the `chrome.webRequest.onHeadersReceived` and `chrome.webRequest.onBeforeRequest` listeners, `getResponseFactsForCapture`, the `responseHeadersByTab.delete` call in the `chrome.tabs.onRemoved` listener, and the imports from `@extension/utils/headers`; `extension/src/utils/headers.ts` whole (`RawHeader`, `normalizeResponseHeaders`, `CachedResponse`, `CaptureResponseFacts`, `responseFactsForCapture`) | 5 | `tests/extension/headers.test.ts` goes; the "the status a manual capture attests (#797)" block of `tests/extension/manualCaptureConcurrency.test.ts` goes; the `webRequest` stubs in the other mocks go |
| Multipart upload | `extension/src/utils/api.ts`: `sendMhtmlCapture` with its `CaptureUploadResult` and `CaptureUploadSource` imports, every field of `AttachCapturePayload` and `buildAttachForm` beyond the Case, URL, Tag, and Note, and `testCapturePipeline`, which nothing in the extension calls | 5 | `manualCaptureConcurrency.test.ts`: the "#379", "#982", and "capture card acquisition boundary" blocks are rewritten for the relay; `tests/extension/selectionAction.test.ts`: the "tag and quote ride the #392 attach endpoints" block is rewritten for D10 |
| `HOTFIX:` auto-capture blocks | `background.ts`: `dedupeMap` and the commented `dedupeWindowMs`; the commented `autoCaptureMode`; the two commented lines in `checkStatus`; the commented `shouldCapture`, `shouldSelectorCapture`, and `captureTab`; the commented `handleSelectorCapture`; the commented block in `checkSelectorsOnTab`; the commented block in the `chrome.tabs.onUpdated` listener; `selectorDedupeMap`; and the `dedupeMap.clear()` and `selectorDedupeMap.clear()` calls in the `SESSION_STOPPED` listener. The comments that name these blocks are reworded: the one above `DEFAULT_DEDUPE_WINDOW_SECONDS` in `src/shared/constants.ts`, the two JSX comments in `CapturePreferences.tsx`, and the one in `ConnectionStatus.tsx`; the settings they describe stay | 2 | None: no test runs commented code |
| Permissions | `extension/manifest.json`: `pageCapture` and `webRequest` (D15) | 5 | None |
| Upload route | `captureServer.ts`: the `POST /api/captures` route, `screenshotFileOf`, the payload half of `resolveOrIngestCaptureNow` and its 422 answer, and the two status fields D11 drops | 6 | `tests/main/services/captureServer.test.ts`: the upload helper and cases, and the payload cases of the "extension write endpoints (#392)", "POST /api/tags/apply", "concurrent attach requests (#835 review)", and "POST /api/notes" blocks; `tests/main/services/extensionAttachEvents.test.ts` and `tests/main/services/perCaseExclusions.test.ts`: their upload cases |
| Upload schemas | `src/shared/schemas.ts`: `CaptureSourceSchema`, `CaptureUploadSource`, `MAX_HEADERS_JSON_BYTES`, `HeadersFieldSchema`, `CaptureUploadSchema`, `CaptureUpload`, `CaptureUploadResult`, `formatCaptureUploadError`, the payload fields of `ExtensionAttachBaseSchema`, `FormFileSchema` if nothing else uses it, and `autoCaptureMode` and `dedupeWindowSeconds` in `CaptureServerStatus` | 6 | The tests above |
| Upload admission | `captureLifecycle.ts`: the `headers` and `httpStatus` fields of `AdmissionRequest`, and the `auto` and `selector` members of `AdmissionRoute` with the `auto` branch of `resolveAdmittedCase`, unless a stage-2 step has given them a caller | 6 | The `admit` cases that post through the upload route |
| Seeding through the upload | `e2e/fixtures/seed.ts`: `postCapture`, which `seedCapture` and `seedTitledCapture` call; 22 e2e specs use those helpers and 12 post to the route themselves (counted with `grep` at `3d9ef9a9`); `.claude/skills/run-birdbrain/driver.mjs` posts to it too | 6 | `e2e/capture-server-api.spec.ts`: its `/api/captures` cases go. Every other spec moves to a seeding path that does not go through the Companion, for example the direct `ingestMhtmlCapture` call `scripts/dev-seed/seed.ts` makes, behind a test-only switch a packaged build cannot turn on, as CE-2's loopback allowance is |

`manualCaptureTab` and the ingest branch of `handleSelectionAction` stay, without their collection
code: each opens a relay session instead. `prepareTabForCapture`, `removeInjectedBirdbrainUi`, and
`createCaptureSuppression` stay (D6). `CaptureUiSuppressionError` stays only if step 5 uses it for
D6's abandonment; once `pageNotCleanError` and `suppressCaptureUiOrThrow` go, nothing else throws
it. Step 5 also rewrites `SCREENSHOT_COPY` in `extension/src/options/OptionsApp.tsx` (D11). In the
[evidence-affecting paths assessment](2026-07-31-evidence-affecting-paths-assessment.md), the
`extension/src/utils/headers.ts` row goes, the other extension rows keep the blocking tier with
reworded reasons, because the Companion still carries bytes and still edits the DOM before the
engine reads it, and the engine's `companion` module joins as a blocking row.

## How each failure is recorded

| Failure | What happens | Where it shows |
| --- | --- | --- |
| Protocol mismatch (D4) | Refused before attach | Popup message naming the reload |
| Admission refusal: operator name, Case, exclusion, dedup | Refused before attach | Toast, and a `skipped` or `failed` capture activity event as today |
| Chrome refuses the attach: restricted page, `file:` without access, policy | Session ends; nothing written | Toast with Chrome's error |
| The Operator presses **Cancel** on the infobar | Detach reason `canceled_by_user`; the Capture is abandoned | The toast `manualCaptureTab` shows today for a stopped Capture, which says nothing was saved |
| The Operator stops the Capture Session from the popup during the Capture | Before the engine hands the artifacts to `admit` (D7 step 11), the Companion closes the session and the Capture is abandoned; after it, the Capture is kept | The popup's answer to `STOP_CAPTURE`, as today |
| DevTools opens on the tab, or the tab closes | The session detaches; the Capture is abandoned | Toast |
| A command outside the fixed list (D3) | The Companion refuses it; the Capture is abandoned | Toast; Companion and app logs name the method |
| The service worker stops, or a step does not arrive in time | The server abandons the session after a timeout the plan sets | Capture activity feed |
| Birdbrain UI found on the page (D6) | Abandoned | Toast, worded as #386's abort today |
| The URL changes during the Capture | Abandoned | The toast `manualCaptureTab` shows today for a navigation during the Capture |
| A Scroll-to-load step throws (D9) | Abandoned | Toast |
| `Page.captureSnapshot` fails | Abandoned | Toast |
| The screenshot fails, exceeds `MAX_SCREENSHOT_SIZE`, or the setting is off (D8) | Kept; screenshot absent with its reason | Inventory; toast names it |
| The PDF fails | Kept; PDF absent as `failed` | Inventory; toast names it |

No failure before ingest writes a file, a row, or a Manifest Entry.

## Validation

[ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md) asks for known-answer validation of an
evidence-affecting method, and ADR-0034 makes each pairing of engine and browser a separate method.
The suite runs against local fixture servers through CE-2's test-only loopback allowance, in the
pinned Chrome for Testing build of stage-2 decision D23 with the built Companion loaded with
`--load-extension`. Chrome 137 removed that switch from branded Chrome
([Chrome Extensions news, June 2025](https://developer.chrome.com/blog/extension-news-june-2025)),
and the Chrome team's announcement says it "will continue to function as before in non Chrome
brands, such as Chromium and Chrome For Testing"
([PSA on chromium-extensions](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY),
2025-04-04). The suite passes `--disable-field-trial-config`, because the stage-2 probe found that
Chrome for Testing's field-trial configuration adds script parts to `Page.captureSnapshot` output
and that the switch removes them (probe P24).

- **The relay.** A command outside the list, an expression outside the list, and a listed script
  sent to a context other than the session's isolated world are refused, and a test fails if the
  engine's companion module can send any of them. No cookie-reading command appears in the
  Companion's log.
- **Admission.** An excluded URL, a missing operator name, and a protocol mismatch each refuse with
  no call to `chrome.debugger.attach`.
- **Artifacts.** For a fixture page, the MHTML matches, part for part by the method of the stage-2
  probe's P24, the `chrome.pageCapture.saveAsMHTML` output that probe question P2 records for the
  same page, or the difference is recorded; the text equals `document.body.innerText`; a page
  exported from a `companion` Capture verifies.
- **#635's checks.** A page whose height is not a multiple of the viewport yields an image as tall
  as its content box (#610); at display scales 1.25 and 1.5 the image size matches the content box
  times the scale (seam drift at fractional device pixel ratios); a fixed header and a sticky header
  each appear once, which the probe confirms before the suite fixes it as the known answer; a page
  above the caps records `truncated: true`; and no Birdbrain node appears in any artifact while a
  toast and highlights are on the page (#386).
- **Scroll-to-load.** A lazy-loading fixture records each outcome of first-slice plan D5, a
  Capture without the scrolling item records `requested: false`, and a failing step abandons the
  Capture.
- **Abandonment.** Cancel on the infobar, a stop from the popup before step 11, a navigation during
  the Capture, and a stopped service worker each leave no file, row, or entry.
- **Capture-then-attach.** Two concurrent Tags on a URL the Case has no Capture of produce one
  Capture with both Tags (#835).
- **Verifier.** An entry with `method: 'companion'` verifies in the shared and the standalone
  verifier, with the screenshot present and with it absent for each reason; the same entry under
  the older stamp fails its refine; an older verifier reports itself too old; and a two-peer
  `MemoryTransport` test shows a receiver verifying it, as CE-7 and CE-8 have.

## Alternatives rejected

- **The extension takes the artifacts over `chrome.debugger` and uploads them,** #635's proposal.
  It improves the screenshot and keeps the extension as the acquirer, which ADR-0034 rejects.
- **Keeping the stitcher as a fallback** (#635, step 3). ADR-0034's consequences settle it: "the
  stitcher goes".
- **A session-long attach in the everyday browser.** ADR-0034 and ADR-0002 keep it unbuilt.
- **Reloading the page after the attach to get a Transaction Record.** A reload is a second
  observation (ADR-0034, Context).
- **Keeping the `webRequest` listener for the status and headers.** It keeps an extension API on
  the evidence path, the thing ADR-0034 removes (Q4).
- **Signing the browser identity the Companion reports.** Stage 2 signs engine-observed values in
  those fields (D12).
- **Asking for `debugger` at the first Capture.** Chrome does not allow it as an optional
  permission.
- **A WebSocket or Native Messaging transport, for now** (D2).
- **Moving the extension's in-page Selector matcher into the engine in this stage.** The Companion
  keeps highlights under ADR-0034, and stage 2 already gives launched browsers their own matching.

## What this asks of ADR-0034

This spec leaves ADR-0034's decisions as they are: the app acquires, the Companion opens a pipe and
attaches per Capture, `companion` never carries a Transaction Record or Bound TLS Details,
`extension` stays a legacy value, and this stage follows launched Chromium browsers. Q3 and Q4
ask the maintainer about two proposed amendments. D6 is this spec's reading of "no extension
code decides which bytes become evidence", not an amendment; the maintainer may rule otherwise.

## Decisions

Each is a proposal awaiting the maintainer's ruling.

- **D1. The Companion relays and the engine decides** ([The pipe](#the-pipe)).
- **D2. HTTP request and response round trips on the existing Capture Server**, opened by the
  Companion; WebSocket and Native Messaging rejected for now ([The pipe](#the-pipe)).
- **D3. A fixed list of commands and scripts in `src/shared`**, enforced by the Companion whatever
  authentication says ([The pipe](#the-pipe)).
- **D4. A protocol version on both sides**, checked before any attach ([The pipe](#the-pipe)).
- **D5. Admission before the attach, and again at ingest**, with the dedup window applied once
  ([Admission](#admission)).
- **D6. The suppression bracket stays in the Companion, and the engine checks the page**
  ([Keeping Birdbrain's own UI out of the artifacts](#keeping-birdbrains-own-ui-out-of-the-artifacts)).
- **D7. The sequence**, with the timestamp from the main process and the URL checked at both ends
  ([The `companion` Capture sequence](#the-companion-capture-sequence)).
- **D8. One screenshot or a recorded absence, truncated above the caps**
  ([The screenshot](#the-screenshot)).
- **D9. Scroll-to-load in the engine, recorded, failing closed, without the overflow unlock**
  ([Scroll-to-load](#scroll-to-load)).
- **D10. Capture-then-attach as one server operation**
  ([Capture-then-attach](#capture-then-attach)).
- **D11. The route table**, with `POST /api/captures` removed and `captureScreenshots` kept for
  the options page ([What remains of the Capture Server](#what-remains-of-the-capture-server)).
- **D12. The `companion` entry**, without status, headers, `egressKind`, `egressLabel`, or
  `userAgent`, with `boundTlsAbsent: 'not-recorded'`, and with the browser identity unsigned on the
  row ([The `companion` Manifest Entry](#the-companion-manifest-entry)).
- **D13. The wording**, with the Persona as declared by the Operator ([Wording](#wording)).
- **D14. Old Captures read as `extension`, and a new ingest must name a method that is not
  `extension`**; the self-test and the fixture builders pass `companion`
  ([The legacy `extension` value](#the-legacy-extension-value)).
- **D15. The manifest adds `debugger` and a Chrome 118 floor, and drops `pageCapture` and
  `webRequest`** ([The extension manifest](#the-extension-manifest)).
- **D16. #1667's extension half is met by removing the fallback**
  ([Closing #1667's extension half](#closing-1667s-extension-half)).
- **D17. A verifier release before the writer**, carrying `companion`, an absent screenshot,
  `requested: false`, and the stage-2 reason for a missing Transaction Record unless the stage-2
  step carries them, and a Case Archive check
  ([Manifest schema and verifier](#manifest-schema-and-verifier)).

## Open questions

**Q1. How do the Companion and the app authenticate each other?** Today `/api/status` gives the
token to any local process, under any account, and to any installed extension. With the pipe,
whoever holds the token can feed the engine forged CDP answers and write a `companion` Capture
that its entry calls operator-witnessed, and a process that takes port 19845 while Birdbrain is
not running receives the artifacts of every Capture the Operator starts. A loopback port accepts
connections from every account on the machine, which is why stage 2 chose the debugging pipe over
a port (stage-2 spec, The browser connection), and port 19845 is above 1023, so any account can
listen on it while Birdbrain is not running.

- **(a) Keep the token as it is**, with D3's list as the only new guard. No Operator step. It
  leaves both exposures above, and the second is one `SECURITY.md` does not list.
- **(b) Pair once with a code the Operator confirms (recommended).** The app shows a pairing code,
  and the Operator enters it in the Companion's options page. Both sides keep the secret behind it,
  the app in its settings and the Companion in `chrome.storage.local`, and each relay request and
  each answer carries an HMAC under it, so each side checks the other. `/api/status` stops
  returning the token, and the GET routes `SECURITY.md` lists as unauthenticated can require it
  too. This closes the other-extension and other-account cases. It does not stop code running as
  the Birdbrain user, which can read both stores and which `SECURITY.md` places out of scope. It
  costs one Operator step per install, a pairing screen on each side that needs design, and a
  `SECURITY.md` rewrite.
- **(c) Native Messaging.** Chrome starts the host only for the extensions in `allowed_origins` and
  passes the caller's origin as the host's first argument
  ([native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)).
  It costs everything in D2's column C, and `allowed_origins` needs an ID that stays fixed while
  the Companion loads unpacked; the manifest reference gives a `key` as the way to keep one ID
  during development
  ([Manifest - key](https://developer.chrome.com/docs/extensions/reference/manifest/key), last
  updated 2013-05-12).
- **(d) Pin the Companion's extension ID.** A manifest `key` fixes the ID, and `/api/status`
  returns the token, and the CORS rule answers, only for that `chrome-extension://` origin. The
  `key` reference names this use: "To configure a server to only accept requests from your Chrome
  Extension origin". Chrome normally sends an `Origin` on the extension's status poll (the comment
  above `includeToken` in `createApp`), and a script in the browser cannot set that header itself,
  because `Origin` is a forbidden request-header name
  ([Fetch](https://fetch.spec.whatwg.org/#forbidden-request-header)). It closes the
  other-extension case with no Operator step. It does not close the other-account
  or squatting cases: any local process can send whatever `Origin` header it likes, and nothing
  lets the Companion check who answers on the port.

Recommendation: (b). The pipe raises what a forged Companion or a squatting process gains from
"write a Capture" to "drive the debugger on the Operator's signed-in tab, within D3's list". Option
(b) and (c) both let the Companion check the other end, and (b) does it with no new permission and
no host program. Option (d) can ship with (b) or before it, as the cheaper fix for the
other-extension case. Q1 needs a ruling before step 4, because it fixes the relay's
message shape.

**Q2. Does the stage-2 verifier step also teach `companion`?** If this spec is approved before that
step merges, `companion` and its absence reasons can ride the same release and schema number. A
released verifier cannot be recalled, and each verifier release asks Shared Case members to upgrade
together. Recommendation: yes, if the stage-2 step has not merged by then; otherwise step 3 takes
the next number in the manifest schema lane.

**Q3. Correct ADR-0034's infobar wording?** ADR-0034 says the per-Capture attach "shows Chrome's
debugging infobar for the length of one Capture". Chromium's source shows it in every window and
hides it five seconds after the last detach (see
[The `debugger` permission](#the-debugger-permission)). Recommendation: amend the sentence to "in
every Chrome window, from the attach until about five seconds after the detach". The decision does
not change.

**Q4. Accept that a `companion` Capture records no HTTP status or response headers?** `extension`
Captures anchor both, from `webRequest` (#119, #797). ADR-0034's consequences do not mention the
loss.

- **(a) Record neither, and amend ADR-0034's consequences to say so (recommended).** The schema
  already omits an unknown status rather than inventing one (`ManifestCaptureEntrySchema`, the R7
  comment), and the reports print what the entry anchors.
- **(b) The engine reads the status from the page's navigation timing entry.**
  `PerformanceNavigationTiming` extends `PerformanceResourceTiming`
  ([Navigation Timing](https://w3c.github.io/navigation-timing/)), whose `responseStatus` getter
  returns the entry's response status
  ([Resource Timing](https://w3c.github.io/resource-timing/)). It recovers a status but not the
  headers, and the value is what the page's own timeline reports, so it needs a new field that says
  so; one field cannot hold both an observed and a page-reported status.
- **(c) Keep the `webRequest` listener.** It keeps an extension API on the evidence path.

Recommendation: (a), because (b) adds a field whose meaning a reader has to learn and (c) undoes
part of ADR-0034. If the maintainer wants a status, (b) is the only option that leaves ADR-0034
whole.

**Probe questions for step 1:**

- **P1. Commands over `chrome.debugger`.** Whether D3's commands answer over `chrome.debugger` in
  Chrome, Edge, and Brave on each platform available, including `Page.captureSnapshot` and
  `Page.printToPDF`, and `Runtime.evaluate` in an isolated world without `Runtime.enable`.
- **P2. MHTML equivalence.** `Page.captureSnapshot` against `chrome.pageCapture.saveAsMHTML` on the
  same page, compared part for part by the stage-2 probe's P24 method. The probe commits the
  `pageCapture` output as the known answer for [Validation](#validation), because step 5 removes
  `pageCapture` from the Companion.
- **P3. Size.** The largest MHTML, PNG, and PDF one `sendCommand` answer carries, and the time.
- **P4. Device pixels.** The image size against the CSS size at display scales 1, 1.25, 1.5, and 2,
  and whether D8's caps need the ratio.
- **P5. The infobar.** Which windows show it, how long it stays after the detach, what a pending
  command receives when the Operator presses **Cancel** (the source answers it as detached), how
  many pixels it takes from the captured tab's viewport and whether the page receives a `resize`
  event, and
  the wording in Edge and Brave.
- **P6. Refused attaches.** DevTools open on the tab, another extension attached, a Chrome Web
  Store page, a `file:` page, the PDF viewer, and a screenshot policy; the error text of each.
- **P7. Service worker lifetime** across a 120-second Scroll-to-load with the debugger attached,
  and whether any one `sendCommand` comes near the five-minute limit the lifecycle page sets on "a
  single request, such as an event or API call".
- **P8. Waiting for lazy loads.** Whether the engine can wait for network quiet without `Network`,
  and what the page can observe if it enables it, with the stage-2 probe's P3 checks.
- **P9. What the page can observe.** The stage-2 probe's P2 and P3 facts for the sequence on the
  Operator's tab, against today's stitcher.
- **P10. Install and reload.** What Chrome shows when the unpacked Companion is reloaded with
  `debugger` added, and when a packed copy updates.
- **P11. Browser identity.** What each product's service worker reports in `navigator.userAgent`
  and `navigator.userAgentData`.
- **P12. Tabs not in front.** A Capture of a background tab, and of a tab in a minimized window.
  The stage-2 probe captured a tab behind another in launched Chrome 150 over the debugging pipe
  (probe P2); this checks the same over `chrome.debugger` in the everyday browser.

## Proposed PR split

A proposal for the stage-3 plan, which settles it. Every code step is evidence-affecting at the
blocking tier, so it gets human review and never merges automatically. Each code step verifies
with `pnpm lint`, `pnpm typecheck`, `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`, `pnpm build`, and
`pnpm preflight` at head, which runs `pnpm build:extension` when `extension/` changes. Steps 3 to 6
follow stage 2's code steps, as ADR-0034's order of work puts this stage after launched Chromium
browsers.

1. **Probe (docs only).** Answers P1 to P12 in the form of the
   [stage-2 probe](2026-10-11-capture-engine-launched-browser-probe-spike.md), with the script in
   the doc. Lane: none. Hot files: none. Done when each P question has a measured answer or is
   marked not measurable on the machines available. Verify with
   `.claude/hooks/vale-prose.sh --base origin/main`.
2. **Remove the `HOTFIX:` blocks.** The `HOTFIX:` row of the deletion list: the commented
   auto-capture code, the two dedup maps, and the comments in the app that point at them. This
   spec proposes that it may land before stage 2, because it changes no behavior and acquires
   nothing, and ADR-0034's order of work orders acquisition work; the maintainer may rule that it
   waits with the rest. Lane: none. Hot files: `extension/src/background.ts`, first in this stage's
   order, and the comment-only edits in `src/shared/constants.ts`, `CapturePreferences.tsx`, and
   `ConnectionStatus.tsx`. Done when `grep -rn "HOTFIX" extension/src src` finds nothing and the
   extension tests pass unchanged.
3. **Verifier release step.** D17, and Q2's answer. Lane: manifest schema, after the stage-2
   verifier step or under its number; Case Archive only if D17's check needs the bump. Hot files:
   `src/shared/schemas.ts`, `src/shared/types.ts`, `src/shared/constants.ts`, and `manifest.ts`,
   which joins the roadmap's `manifest.ts` order after the stage-2 verifier step. Starts also in
   `src/shared/verify/` and `src/verifier/`. Done when entries written before the change still
   verify, a `companion` entry verifies in the shared and the standalone verifier with the
   screenshot present and absent and with `requested: false`, an unknown method or reason fails
   strict parse, and a `companion` entry under the older stamp fails its refine. Also verify with
   `pnpm build:verifier`. A tagged release ships it before step 5 merges, and its notes tell Shared
   Case members to upgrade together.
4. **The relay and pairing, with no Capture.** D1 to D4, D15's `debugger` permission and Chrome
   floor, and Q1's answer. After stage-2 step 3, which builds the CDP client, and the ruling on Q1.
   A relay session attaches, reads `Page.getNavigationHistory`, and detaches; nothing is ingested.
   Lane: none. Hot files: `captureServer.ts`, `extension/src/background.ts`,
   `extension/src/utils/api.ts`, `extension/src/options/OptionsApp.tsx` if Q1's answer adds a
   pairing screen, `extension/manifest.json`, and `SECURITY.md`; `src/shared/ipc.ts` only appends.
   Starts in a new module under `src/main/services/`, placed per `docs/agents/architecture.md`, and
   the stage-2 client's module. Done when the relay and protocol-mismatch items of
   [Validation](#validation) pass and the suite runs in CI against the pinned Chrome for Testing
   build.
5. **Clicked `companion` Captures, and the Companion stops acquiring.** D5 to D10, D12 to D14, D16,
   and the Companion half of the deletion list, with its tests. After step 3's release, step 4, CE-P
   steps 6 and 10 (the screenshot record, the Scroll-to-load outcome, and the PDF), CE-3, and the
   stage-2 clicked-Capture step, which holds `captureLifecycle.ts` before it. Lane: none; no
   migration, because `captures.method` is plain `TEXT`. Hot files: `captureLifecycle.ts` (after the
   stage-2 clicked-Capture step), `captureServer.ts`, `background.ts`, `content.ts`,
   `captureSuppression.ts`, `api.ts`, `OptionsApp.tsx`, `manifest.json`, `src/shared/constants.ts`,
   `reportHtml.ts`, `certification.ts`, `verifyRunbook.ts`, and
   `src/renderer/components/captures/captureMethodLabel.ts`. Starts also in the three fixture
   builders under `scripts/` (D14). Done when every item of [Validation](#validation) passes in the
   suite, `grep` finds no `pageCapture`, `captureVisibleTab`, or `webRequest` in `extension/src` or
   `extension/manifest.json`, and `CONTEXT.md` drops _Planned_ from the Companion and `companion`
   clauses. The published pages that describe extension capture and
   `docs/agents/capture-pipeline.md` change in the same PR (see
   [Review and approval](#review-and-approval)). Its body says "Refs #1667". Also verify with
   `pnpm test:e2e`.
6. **The Capture Server stops taking uploads.** D11 and the server half of the deletion list:
   the upload route, schemas, and admission fields, and the e2e seeding path. After step 5, in the
   same release, because the Companion and the app ship together and D4 refuses an old extension
   with a message. Lane: none. Hot files: `captureServer.ts`, `src/shared/schemas.ts`,
   `captureLifecycle.ts` (after step 5), `e2e/fixtures/seed.ts`, and
   `.claude/skills/run-birdbrain/driver.mjs`. Done when no code or test posts to `/api/captures`,
   the e2e suite passes through the new seeding path, and the `CONTEXT.md` Capture Server, Capture
   Lifecycle, and Active Case entries and the threat model describe the Companion. Also verify with
   `pnpm test:e2e`.

## Not in this stage

A Firefox Companion, which opens no pipe (stage 4, ADR-0034); a session-long attach in the everyday
browser; changes to the Companion's in-page Selector matcher; passive capture, which returns only in
a launched browser (ADR-0037); publishing the Companion to the Chrome Web Store or any other store;
right-click image saving (`extension-image`, ADR-0023, #47); and the settings `autoCaptureMode` and
`dedupeWindowSeconds`, whose future the code comments leave to #571.

## Review and approval

The implementation changes an acquisition path, the Manifest, and the verifier, and gives the
Companion a permission that drives the Operator's signed-in tabs. It is evidence-affecting at the
blocking tier, so it gets human review and does not merge automatically. The engine's `companion`
module joins the blocking tier of the
[evidence-affecting paths assessment](2026-07-31-evidence-affecting-paths-assessment.md). The plan
waits for the maintainer's approval of this spec and answers to Q1 to Q4, and the changes to
`SECURITY.md`, the threat model, the published docs that describe extension capture
(`website/content/docs/architecture.mdx`, `features.mdx`, `adoption-guide.mdx`, and
`tester-guide.mdx`), the agent doc `docs/agents/capture-pipeline.md`, and the options page's
`SCREENSHOT_COPY` ship with the code that makes them true.
