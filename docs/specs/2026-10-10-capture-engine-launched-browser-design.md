# Capture engine, stage 2: launched Chromium browsers

**Date:** 2026-10-10

**Status:** Design, awaiting approval. Nothing here is implemented. The maintainer ruled on
decisions D1 to D17 and D19 to D23 on 2026-10-10 (see
[Decisions and rulings](#decisions-and-rulings)); D18 stays open.

**Amended 2026-10-17 by
[ADR-0052](../adr/0052-import-persona-cookies-from-installed-browsers.md):** S3 and
[Cookie seeding from the Persona import](#cookie-seeding-from-the-persona-import), which have
stated the browser cookie import ruling since 2026-10-10, link the ADR that records it. The
seeding section also records that the at-rest assessment of 2026-10-11 made the partition's
at-rest wording true.

**Decisions this rests on:**
[ADR-0034](../adr/0034-the-app-acquires-and-the-extension-is-a-companion.md) (the app acquires,
the extension is a Companion; this stage is the second step of its order of work),
[ADR-0035](../adr/0035-one-transaction-record-per-capture.md) (one Transaction Record per
Capture), [ADR-0036](../adr/0036-credential-header-values-never-enter-a-transaction-record.md)
(credential header values),
[ADR-0037](../adr/0037-passive-capture-returns-in-the-launched-browser.md) (passive capture
returns in the launched browser),
[ADR-0030](../adr/0030-persona-is-a-provenance-axis-beside-operator.md) as amended by ADR-0032
and ADR-0034 (Persona),
[ADR-0032](../adr/0032-route-app-egress-but-do-not-disguise-the-browser.md) (Egress), and
[ADR-0002](../adr/0002-tls-capture-corroboration-only.md) and
[ADR-0013](../adr/0013-passive-capture-scoped-to-a-declared-window.md) as amended.

**Brief:** CE-S2 in `docs/plans/2026-10-10-three-programme-agent-briefs.md`, which had not merged
to `main` when this spec was written. This spec folds in #599 and #600, names #1505 as
superseded (the maintainer closed it on 2026-10-10), and requires #598 to land first, as CE-10.

**Audience:** whoever writes the stage-2 plan and code briefs, whoever implements and reviews
them, and the maintainer, who approves the spec. The maintainer's rulings on its decisions are
under [Decisions and rulings](#decisions-and-rulings).

**Frame of reference:** code citations give a path and line at `origin/main` `df531d36`. Chromium
citations give a path in `chromium/src` at tag `152.0.7977.130`, the Chromium that Electron 44.5.1
ships. Protocol facts come from the `devtools-protocol` package at `0.0.1716261`, and package
facts from the npm registry on 2026-10-10. Measurements come from the probe described under
[Measured for this spec](#measured-for-this-spec).

## Problem

An Operator who wants a signed-in page captured today opens it in their everyday Chrome and
clicks the extension. That Capture has MHTML and a stitched screenshot, and no Transaction Record
or Bound TLS Details, because the page loaded before anything could record it (ADR-0034,
Context). The Persona on it is the Operator's declaration, which the app cannot check
(ADR-0030:47-54). Passive capture is withdrawn (ADR-0013).

ADR-0034 orders the work so that, after the [first slice](2026-09-30-capture-engine-design.md)
adds new artifacts to the background renderer, Birdbrain starts a Chromium browser (Chrome, Edge,
Brave, or Chromium) with a profile directory of its own per Persona, drives it over the Chrome
Devtools Protocol (CDP), and takes `launched` Captures there (ADR-0034:53-60, :82-84). The engine
attaches at launch, before any request, so each such Capture can carry a Transaction Record and
Bound TLS Details (:69-73). ADR-0037 brings passive capture back in that browser only
(ADR-0037:28-36).

Neither record says how Birdbrain finds, starts, connects to, and stops that browser; how each
Persona's browser profile is laid out and seeded from the Persona import; which switches carry
the Egress; which CDP client the engine uses; how the Operator triggers a Capture; how a recording
that runs for a whole Capture Session becomes one Transaction Record per Capture; who owns the
tabs a page opens; how Selectors are matched (ADR-0037:73-74); or what the `launched` and
`launched-passive` Capture Methods and the Persona wording say. This spec designs those from
three directions: what the Operator does, what each Capture must prove, and what can go wrong on
the Operator's machine and network.

## Prerequisites and related issues

1. **The first slice lands first.** A `launched` Capture writes the same artifacts as a
   `background` Capture. The WARC writer, the inventory, Bound TLS Details, the Scroll-to-load
   outcome, the PDF, and their verifier fields come from the first slice (briefs CE-5 to CE-9).
   This stage adds no second writer and no second inventory shape.
2. **#598 lands before any stage-2 code brief, as CE-10.** `runDataExtraction` runs synchronously
   on the main process (`src/main/services/captureLifecycle.ts:723`, comment at :724-725), and
   passive capture pays that cost once per page browsed (ADR-0013:62, ADR-0037:63-64). A launched
   browser also sends the main process a CDP event for every request of every tab while a Capture
   Session runs. The maintainer ruled #598's direction on 2026-10-10: extraction runs in a utility
   process (CE-10), which the CI-4 field build may share. #598 is `ready-for-agent` with that
   direction.
3. **#1505 is superseded.** It builds an Electron persona window that writes `persona-window`.
   ADR-0034 withdrew that method (:79-80) and made a witnessed Capture under a Persona a `launched`
   Capture in that Persona's browser profile (:100-102), which this spec specifies. On 2026-10-10
   the maintainer closed #1505 as superseded by this design and ruled that `persona-window` leaves
   #1498's scope.
4. **#1498 carries the Persona fields.** The `capture` entry has no `personaId` or `personaLabel`
   at `origin/main` (`src/shared/schemas.ts:455-515`). A Persona-stamped `launched` Capture waits
   for the release whose verifier knows those fields.
5. **CE-3 (#1695) adds the Egress setting** that the launch switches read. A launched browser has
   to follow the Egress and fail closed (ADR-0034:144-145), so stage-2 launch code follows CE-3.
   CE-2 (#1726) supplies the shared address classification and the test-only loopback allowance
   that the fixture tests below use. CE-4 (#1696) builds the warning ADR-0032 requires when a
   Capture Session starts while the Egress is Direct and no VPN is seen (ADR-0032:102-104).
6. **#599 and #600 are folded in:** the `launched-passive` value with its reporting surfaces, and
   passive capture in the launched browser.
7. **#1499 keeps the Electron partition** for `background` renders under a Persona. Its sign-in
   window seeds that partition only.

## What exists today

- **Only the background renderer drives a browser.** `renderPageInHiddenWindow`
  (`src/main/services/backgroundRenderer.ts:376`) opens an offscreen `BrowserWindow` on a fresh
  `recapture-<uuid>` partition (:393), denies permission requests and popups (:452-453), and
  attaches `wc.debugger` with no event domain enabled (:465-468). It saves MHTML with
  `wc.savePage` (:519), reads `document.body.innerText` in the page's main world (:521-523), and
  stamps the user agent and `Chrome/<version>` of Electron's own Chromium (:532-533). A comment
  records that enabling a CDP event domain through `webContents.debugger` evicts any other CDP
  client on that target (:48-52). Nothing in the app launches an external browser.
- **Persona sessions.** Each Persona has one Electron partition, `persist:persona-<id>`
  (`partitionForPersona`, `src/main/services/persona/personaSessions.ts:16-18`). `importCookies`
  (:67) parses a Netscape or JSON cookie file with `readCookieFile`
  (`src/main/services/persona/cookieFiles/index.ts:40`), loads each accepted cookie with
  `ses.cookies.set` (:88), flushes, and records the count and time on the row (:106). The file's
  bytes go nowhere else (`cookieFiles/index.ts:38-39`), and the importer refuses a browser profile
  directory or a `Cookies` database (:13-15). `ImportedCookie` keeps `hostOnly` because Electron
  turns any `domain` it is handed into a subdomain cookie (`cookieFiles/types.ts:5-13`).
  `clearPersona` clears the partition, then soft-deletes the row (`personaSessions.ts:113-119`).
  `removeOrphanedPartitions` (:157) removes partition folders whose Persona row is gone, and the
  sweep skips when the database is not beside the session folders (:135-139).
- **The Capture Session** (`createSessionService`, `src/main/services/session.ts:56`; state at
  :22-27) holds one Active Case, a running flag, a capture count, and the extension's heartbeat.
  The app creates one at startup (`src/main/index.ts:571`).
- **Admission.** `admit` (`captureLifecycle.ts:968`) applies the operator-name gate, Case
  resolution, the exclusion policy (`matchCaseExclusion`, :1000), the manual dedup window on the
  `manual` route only (`MANUAL_DEDUPE_WINDOW_MS`, 5 seconds, `src/shared/constants.ts:23`), and
  the session count. It passes no method, so every admitted Capture is `extension` (:1032-1034).
- **Capture Methods** are `extension`, `background`, and `duplicate` (`CAPTURE_METHODS`,
  `src/shared/types.ts:75`). `launched`, `launched-passive`, and `companion` are _Planned_ in
  `CONTEXT.md`. `captures.method` is a plain `TEXT` column
  (`src/main/services/db/migrations.ts:457`), so a new value needs no migration.
- **The `capture` Manifest Entry is strict** (`ManifestCaptureEntrySchema`,
  `src/shared/schemas.ts:455`) and takes `method` from `CAPTURE_METHODS` (:478). Since schema 5 it
  accepts optional `egressKind`, `egressLabel`, `userAgent`, and `tlsSkipped` (:502-505);
  `MANIFEST_SCHEMA_VERSION` is 5 (`src/shared/constants.ts:81`). No build writes the Egress fields
  yet (#1695). The row stores the browser version and user agent unsigned
  (`src/main/services/db/captureRepo.ts:147-148`); the signed entry carries `userAgent` only as an
  Egress field, omitted while the Egress is Direct.
- **Selectors are matched in two places, with different rules.** The extension's
  `checkSelectorsOnTab` (`extension/src/background.ts:1224`) sends the Active Case's Selectors to
  the content script, whose `matchSelectors` (`extension/src/content.ts:95`) runs
  `new RegExp(selector.pattern, 'gi')` (:107) over `document.body.innerText` inside the page with
  no time budget, and highlights the hits by editing the DOM (:578-591). The capture that used to
  follow a match is commented out under `HOTFIX:` (`background.ts:1258`, :1282). At ingest,
  `runActiveSelectorsForCapture` (`src/main/services/selectorLifecycle.ts:159`) reaches
  `selectorMatchesText` (`src/main/services/db/selectorRepo.ts:146-151`): a lowercase substring
  test, or `safeRegexTest`, which runs the pattern in a `vm` sandbox under a 200 ms budget
  (`src/main/services/safeRegex.ts:8`, :26-41).
- **Exclusion fails open on a timeout.** `matchCaseExclusion`
  (`src/main/services/exclusionPolicy.ts:48`) uses the same sandbox. A pattern that exhausts its
  budget yields no match, "so the capture is accepted rather than refused" (comment at :37-38).
- **The runtime.** Electron 44.5.1 runs Node 24.21.0 and Chromium 152.0.7977.130, and its Node
  exposes a global `WebSocket` (measured under `ELECTRON_RUN_AS_NODE=1` on 2026-10-10).

## What each Capture in a launched browser must prove

Each design section below names the requirements it serves.

- **E1. Recording covered the page.** The Transaction Record holds the navigation from its
  document request on, because the engine was attached and recording before that request was
  sent. Where it was not, the Capture says so and carries no Transaction Record; none is
  reconstructed (ADR-0035:37-41).
- **E2. One tab, one navigation, a defined cut.** A reviewer can tell which exchanges belong to the
  Capture and why the record ends where it does (ADR-0035:28-32).
- **E3. No credentials.** The record holds no value of the four credential headers in any field
  the browser reports them in (ADR-0036:26-30), and no password (ADR-0030:62-65: "Passwords are
  never stored").
- **E4. The recorded Egress is the Egress used.** The Capture names the Egress the browser
  launched with. While it is not Direct, the launched browser sends nothing directly, and a
  failure stops traffic instead of exposing the Operator (ADR-0032:41-45, :57-62).
- **E5. The recorded Persona is the browser profile's.** The engine stamps the Persona from the
  browser profile the tab ran in. The Operator never picks it at capture time (ADR-0030).
- **E6. Clicked and passive Captures stay distinct** in the Manifest Entry and on every reporting
  surface (ADR-0037:38-41, #599).
- **E7. The browser build is recorded.** Each pairing of engine and browser is a separate method to
  validate (ADR-0034:146), so a Capture names the product and version that produced it.
- **E8. Every absence is recorded.** A missing artifact, exchange, or check appears in the
  inventory or in the capture activity feed.

And four security requirements:

- **S1.** Only Birdbrain can drive the launched browser. S1 holds with the pipe, which decision D1
  chose. Through a debugging port any local process can drive the browser (see
  [The browser connection](#the-browser-connection)), so the port fallback that D1 allows gives up
  S1 for the Capture Sessions that opt in to it, which is why that mode carries a takeover warning.
- **S2.** A Persona's cookie values stay in its browser profile's own store. The engine never
  asks the launched browser for them and replaces them in the events that carry them.
- **S3.** Browser profiles are isolated from each other and from the Operator's everyday browser,
  with one exception the maintainer ruled on 2026-10-10 and
  [ADR-0052](../adr/0052-import-persona-cookies-from-installed-browsers.md) records: a browser
  import copies into a Persona's stores the cookies of the sites the Operator picks in an
  installed browser, or all of its cookies when the Operator states that the source browser
  profile serves this Persona alone (see [Cookie seeding](#cookie-seeding-from-the-persona-import)).
  Nothing else from that browser enters a browser profile.
- **S4.** The launched browser keeps Chrome's sandbox and security defaults: the engine passes no
  switch on Chrome's unsupported-flag list (`kBadFlags`,
  `chrome/browser/ui/startup/bad_flags_prompt.cc:78`).

## The Operator's workflow

Each step states what the Operator does and sees, then the rules it puts on the engine. The
Capture Session panel named here is a product surface with no design yet; this spec fixes only
what it has to show. Under the ruling on decisions D19 and D22, an agent writes a UI brief for the
panel and for telling the launched browser apart from the everyday one, and the Birdbrain UI
design project designs both. The panel's design lands before step 3 builds the panel, and a
feasibility pass on the mock comes before step 4.

### Before the first Capture Session

Settings lists the supported Chromium browsers Birdbrain found on the machine, with each one's
version, and lets the Operator choose an executable Birdbrain did not find.

*Engine rule:* discovery launches nothing. Birdbrain confirms a browser's product and version
only when it launches it (see [Browser discovery and launch](#browser-discovery-and-launch)).

### Starting a Capture Session in a launched browser

The Operator has an Active Case and an operator name. They launch a browser from Birdbrain and
choose the browser, a Persona or none, and what the Capture Session captures without a click:
nothing, every page that loads, or the pages an Active Case Selector matches. The last two appear
only once #600 lands. The start dialog shows the Egress and its label without letting the Operator
change them, and the CE-4 warning while the Egress is Direct and no VPN is seen. Birdbrain then
launches the browser and shows the Capture Session panel. The first tab is `about:blank`.

*Engine rules:*

- **A launched browser never outlives its Capture Session** (decision D20, ruled 2026-10-10).
  Launching a browser starts a Capture Session if none is running; if one is already running, the
  browser joins it and its Active Case. Ending the Capture Session closes the browser. Closing the
  browser's last window closes the browser only, and the Capture Session keeps running until the
  Operator stops it in Birdbrain: the session service holds one running flag (`sessionActive`,
  `src/main/services/session.ts:22-27`) with one `start` and one `stop` (:118-127), which the
  extension uses too, and `CONTEXT.md` defines a Capture Session by the Operator starting and
  stopping work (:70). No launched browser runs outside a Capture Session, so every page loaded in
  it is one the engine could record from its first request, the promise of ADR-0034:69-71. The
  ruling narrows the `CONTEXT.md` Capture Method entry (:78) and ADR-0034 to match.
- **Birdbrain checks the operator name before it launches the browser.** `admit` refuses a
  Capture without one; checking at launch keeps an Operator from browsing for an hour and then
  finding every Capture refused.
- **One launched browser at a time** in the first stage-2 release (decision D10, ruled
  2026-10-10). Two signed-in browsers under two Personas side by side make wrong-persona capture
  easier, a risk the threat-model delta (#546) owes an answer for (ADR-0030:94-96).
- **The Operator chooses the Persona when launching the browser** (decision D21, ruled
  2026-10-10), from a picker that defaults to none, and the choice holds for that browser's life.
  The persona plan chose a per-job picker with no app-wide state
  (`docs/plans/2026-09-19-persona-cookie-import.md`, decision 6). A launched browser holds one
  browser profile for its whole life, so the launch is the job: the same value chooses the browser
  profile and stamps every Capture taken in it. The threat-model delta (#546) updates its
  wrong-persona mitigation for that.

### Browsing

The Operator browses as in any browser. A Persona's signed-in pages open because the browser
profile holds the Persona's cookies, and the Operator answers any checkpoint by hand. The persona
spike's maintainer ruling rated the four social platforms "Go" for an Electron persona window with
a human present to clear checkpoints
([persona spike](2026-09-19-persona-bot-detection-spike.md), Maintainer ruling); nobody has tried
a launched Chrome against them. The browser shows its own consent banners and permission
prompts. Birdbrain injects nothing into pages: no consent filter, no highlights, no buttons, so
`launched` Captures carry no Consent Suppression, as `CONTEXT.md` already says of
operator-witnessed Captures.

The Capture Session panel lists the browser's tabs: title, URL, whether the engine recorded the
current page from its first request, and the Active Case Selectors the page matches now. That list
writes no Persisted Match; Persisted Matches still come only from ingest through the Selector
Lifecycle. The extension in the Operator's everyday browser keeps working as it does today and
writes `extension` Captures until stage 3.

### Taking a Capture

The Operator captures a tab from the Capture Session panel or with a keyboard shortcut.
Scroll-to-load is a per-Capture choice, off by default, because it scrolls the page the Operator is
reading. The panel shows the Capture's progress, then its Exhibit Number. Tags and Notes are added
in the app, on the new Capture.

*Engine rules:* the shortcut never guesses (see
[The Operator's capture trigger](#the-operators-capture-trigger)); no control lives inside the
page; a Capture belongs to one committed document; and admission is today's `admit`, with a
launched route and `method: 'launched'`.

### Several tabs and windows

The Operator opens tabs and windows, follows links that open new tabs, and lets pages open popups.
All of them belong to the Capture Session. A tab in a private window cannot be captured: the panel
says why, and passive capture skips it.

### Ending the Capture Session

The Operator stops the Capture Session in Birdbrain, which asks for confirmation and then closes
the browser. Closing the browser's last window closes the browser only: the Capture Session keeps
running, and the panel says the browser has closed (decision D20). Quitting Birdbrain closes the
browser. A browser left running after Birdbrain exits would look like a recording browser and
record nothing; whether Chromium exits when its debugging pipe closes is not measured (open
question P8).

## Design

### Browser discovery and launch

Serves E7, S3, S4.

**Discovery.** Birdbrain keeps a table of known install locations and executable names per
product and operating system, checks them, and adds an executable the Operator picks.
`@puppeteer/browsers` 3.2.4 (Apache-2.0) keeps such a table for Chrome channels
(`resolveSystemExecutablePaths`, `lib/browser-data/chrome.js:192`); Edge, Brave, and Chromium need
their own entries, which the plan takes from each vendor's install documentation. Reading that
table adds no dependency. Browsers installed through Snap or Flatpak are open
question P20.

**Identification.** After launch the engine reads `Browser.getVersion` and refuses a product it
does not recognize, or one below the supported floor, with a message. The floor is the oldest
version on which the stage-2 probe passes. The product string matters because the user agent does
not identify the build: Chrome 150 reported its product as `Chrome/150.0.7871.181` while its user
agent said `Chrome/150.0.0.0` (probe).

**Birdbrain owns the whole argument list.** No library default is used.

| Switch | When | Source |
| --- | --- | --- |
| `--user-data-dir=<browser profile>` | always | Chrome 136 and later ignore the remote-debugging switches on the default profile directory ([Chrome for Developers](https://developer.chrome.com/blog/remote-debugging-port)). Chromium applies that check to Google Chrome builds (`IsRemoteDebuggingAllowed`, `chrome/browser/devtools/remote_debugging_server.cc:162-183`); a Birdbrain-owned directory satisfies it for every product |
| `--remote-debugging-pipe` | always, except in the port fallback of decision D1 | `content/public/common/content_switches.cc:600-604` |
| `--no-first-run`, `--no-default-browser-check` | always | Skip first-run prompts and change nothing a page sees (`chrome/common/chrome_switches.cc:472`, :451); the probe used both |
| `--proxy-server=<scheme>://<host>:<port>`, with no `direct://` entry | while the Egress is not Direct | ADR-0032:57-62; see [Egress](#egress) |
| `--webrtc-ip-handling-policy=disable_non_proxied_udp` | while the Egress is not Direct | `chrome_switches.cc:726`, mapped to the WebRTC IP handling preference in `chrome/browser/prefs/chrome_command_line_pref_store.cc:55` |
| `--disable-sync` | always (decision D15) | "Disables syncing browser data to a Google Account" (`components/sync/base/command_line_switches.h:10-11`) |
| `about:blank` as the start URL | always | The first tab makes no request |

**Excluded switches.**

- `--enable-automation` sets the automation flag (`content/child/runtime_features.cc:395`) and is
  the switch that raises Chrome's "controlled by automated test software" infobar
  (`chrome/browser/ui/startup/infobar_utils.cc:86-89`, :132-134).
- `--remote-allow-origins` lets the listed web origins open the debugging WebSocket that Chrome
  otherwise refuses (`content/browser/devtools/devtools_http_handler.cc:819-831`, :928-933).
- `--no-sandbox`, `--host-resolver-rules`, and `--log-net-log` are on Chrome's unsupported-flag
  list (`bad_flags_prompt.cc:78-94`; S4). Validation may use a net log; a shipped launch never
  does.
- `--password-store=basic` selects "the plain text store" on Linux
  (`docs/linux/password_storage.md:32`), and `--use-mock-keychain` is a macOS switch "for testing
  purposes" (`components/os_crypt/common/os_crypt_switches.h:16-18`). Puppeteer passes both by
  default (`puppeteer-core` 25.13.0, `lib/puppeteer/node/ChromeLauncher.js:184-185`).
- `--disable-blink-features=AutomationControlled`, or any switch whose purpose is to hide
  automation, is fingerprint impersonation, which ADR-0032 excludes (:116-118).
- `--headless`, because the Operator browses in the window, and `--load-extension`, because no
  extension code belongs in the browser that acquires evidence (ADR-0034:43-45).
- `--disable-background-networking`, which Chromium describes as "for use when doing network
  performance testing" (`chrome_switches.cc:207-210`); decision D15 keeps background networking
  on.

**Start order.** The engine spawns the browser, waits for `Browser.getVersion` to answer within a
timeout, sets up attaching (see [Attach before request](#attach-before-request)), runs the Egress
checks on the first tab, and only then shows that tab to the Operator. If the browser does not
answer, the engine kills it and says the browser did not open its debugging connection. An
enterprise policy can cause that: Chrome starts no debugging connection when its
remote-debugging-allowed preference is off and reports the reason as disabled by policy
(`remote_debugging_server.cc:164-167`, :339-340).

**Stop.** Ending the Capture Session sends `Browser.close`, kills the process after a timeout, and
deletes a throwaway browser profile (see
[Browser profiles per Persona](#browser-profiles-per-persona)).

**Where the launcher runs.** The launcher and the CDP client run in the main process (decision D4,
ruled 2026-10-10). Extraction moves to a utility process under the ruling on #598 (CE-10), and the
CDP client moves there too only if measurements show it stalls. Every network event of every tab
crosses this layer, the kind of load #598 exists to keep off the main process.

### The browser connection

Serves S1, S2. The maintainer ruled on 2026-10-10 that the transport is the pipe (decision D1).
This section gives the evidence, the ruling, and the port fallback the ruling allows.

ADR-0034 says Birdbrain starts the browser "with a remote-debugging port" (:54). Chrome offers two
transports. `--remote-debugging-port=<n>` opens a WebSocket listener on `127.0.0.1`
(`remote_debugging_server.cc:134`). `--remote-debugging-pipe` speaks the same protocol over
inherited descriptors 3 and 4 (`content_switches.cc:600-604`), with messages ended by a NUL byte by
default (`content/browser/devtools/devtools_pipe_handler.cc:292-296`); on Windows the handler opens
handles from the same descriptors (:144, :229). The probe measured both, and port 0, on Chrome 150:

| | Pipe | Fixed port | Port 0 |
| --- | --- | --- | --- |
| Who can drive the browser | The process holding descriptors 3 and 4 | Any local process. A second client using only the URL from `/json/version` was accepted and answered `Browser.getVersion` (probe) | As for a fixed port; the port is also written to `DevToolsActivePort` in the browser profile (`remote_debugging_server.cc:366-374`) |
| What a web page can reach | No listener: with the pipe switch and no port, Chrome starts no HTTP server (`remote_debugging_server.cc:354-361`, :398-417) | Chrome refuses a WebSocket whose `Origin` is not allowlisted and a request whose `Host` is not an IP address or `localhost` (`devtools_http_handler.cc:819-831`, :460-466) | As for a fixed port |
| `navigator.webdriver` in a page | `true` | `false` | `true` |

The last row follows from Chromium's source and matches the probe. `--remote-debugging-pipe`,
`--enable-automation`, and `--headless` turn on the automation flag
(`runtime_features.cc:395-397`), and so does `--remote-debugging-port=0`, while "if the caller
provides a specific port number, this is more likely for attaching a debugger, so we should leave
EnableAutomationControlled unset" (:438-453). `Navigator::webdriver` returns that flag
(`third_party/blink/renderer/core/frame/navigator.cc:100-107`).

**Ruling: the pipe.** A debugging port lets any process on the machine, under any user account,
read every cookie of the Persona whose browser is open (`Storage.getCookies`) and drive that
signed-in browser for as long as the Capture Session runs.
Chrome's own reason for the Chrome 136 change was "an increase in attackers using Chrome Remote
Debugging to extract cookies" (Chrome for Developers, above). `SECURITY.md` scopes out "Attacks that
require running code as the Birdbrain user on the same machine" (line 23), and a loopback TCP port
accepts connections from every account. The pipe also keeps the question #548 asks (is the Operator
still human-only when an agent acts?) out of stage 2: nothing but Birdbrain can steer the launched
browser, so no agent's action can be recorded as an operator-witnessed `launched` Capture.

The cost is that every page in the launched browser reads `navigator.webdriver` as `true`, and a
site can use that to challenge or refuse. ADR-0032 rule 7 records a challenge page as what the
site served (:83-85), and in a launched browser the Operator is present to answer it. Stage 4 has
the same property: ADR-0034 accepts that a WebDriver BiDi session reports itself through
`navigator.webdriver` (:140-143). The ruling amends ADR-0034's "with a remote-debugging port" to
"remote-debugging connection".

**The port fallback**, built only if the pipe proves problematic: an opt-in port mode per Capture
Session, on a fixed loopback port Birdbrain chooses, which keeps `navigator.webdriver` false (see
the table above). The mode shows a warning that another process could take over the browser, and
the signed record states the transport (see
[Manifest, schema, and verifier](#manifest-schema-and-verifier)). It gives up S1 for the Capture
Sessions that opt in. Two things decide whether it is built. First, stage 2 measures the pipe on
Windows and macOS (P7) before step 4 of the [PR split](#proposed-pr-split), the first capture
step. Second, the app counts bot-challenge refusals in launched browsers. How the engine detects a
refusal is open question Q2, and the stage-2 plan assigns the step that builds the count.

Whatever the transport, the engine never sends `Emulation.setAutomationOverride` (experimental in
`devtools-protocol` 0.0.1716261): hiding the automation flag presents a browser that did not exist,
which ADR-0032 excludes.

### The CDP client

The engine needs a CDP client in the main process: spawn and pipe framing, a browser-level
connection, flattened per-target CDP sessions routed by `sessionId`, command timeouts, and
disconnect handling. The maintainer ruled on 2026-10-10 for option A, with no runtime dependency
(decision D2).

| Option | Transport | Package facts (npm registry, 2026-10-10) | What it means for the engine |
| --- | --- | --- | --- |
| A. A client in `src/main` (ruled) | pipe | No runtime dependency. Types written by hand for the commands used, or taken from `devtools-protocol` 0.0.1716261 (BSD-3-Clause, no dependencies) as a development dependency | The engine sends every command itself, so the domains enabled are the ones the code names and the probe measured. The probe's client is a few dozen lines: framing, request ids, routing by `sessionId` (appendix). The stage-1 renderer already speaks raw CDP through `wc.debugger.sendCommand` |
| B. A client in `src/main` | port | No dependency: Node 24's global `WebSocket` in Electron 44.5.1 | Same control as A, with the port's exposure |
| C. `chrome-remote-interface` 0.34.0 | port only | MIT; depends on `ws` and `commander`; published 2026-02-09. Its `lib/` connects with `ws` and has no pipe transport | A thin client that forces the port |
| D. `puppeteer-core` 25.13.0 | pipe or port | Apache-2.0; depends on `ws`, `chromium-bidi`, `devtools-protocol`, `@puppeteer/browsers`, `typed-query-selector`, `webdriver-bidi-protocol`; 6.0 MB unpacked; Node 22.12 or later; published 2026-10-08 | Its page layer enables `Page` and `Runtime` (`lib/puppeteer/cdp/FrameManager.js:254-260`), `Network` (`NetworkManager.js:77`), and `Performance` and `Log` (`Page.js:331-332`) on every page; `Runtime` is the domain the persona spike ties to a debugger signal. Its launcher defaults include `--enable-automation`, `--password-store=basic`, and `--use-mock-keychain` (`ChromeLauncher.js:178-185`). Usable only below the page layer. The only option that also speaks WebDriver BiDi, which stage 4 needs |
| E. `playwright-core` 1.64.0 | pipe | Apache-2.0; no dependencies; 13.7 MB unpacked; published 2026-10-07. Version 1.63.0 is installed today only through the development dependency `@playwright/test` | Launches Chromium with its own `--remote-debugging-pipe` and `--user-data-dir`, and throws when a caller passes either (`lib/coreBundle.js` in 1.63.0), so the engine would not own the launch. Shipping it at runtime is a new dependency |

**Ruling: option A.** The engine reads raw events (`Network.requestWillBeSent` and its companions)
that the libraries wrap in their own request objects, needs a known set of enabled domains that a
library's page layer decides for it, and needs full control of the launch arguments. A client in
`src/main` adds no runtime dependency. Its cost is a few hundred lines Birdbrain owns and tests, and
because it sits on the evidence path, its size is part of what review and ADR-0004 validation cover.
Stage 4 needs a BiDi client whichever option is chosen here.

**The client sends only listed commands.** The engine's command list is a constant, the client
logs every method it sends, and a test fails if code sends a command outside the list. The list
excludes every command that returns cookie values (`Storage.getCookies`, `Network.getCookies`,
`Network.getAllCookies`) and `Emulation.setAutomationOverride` (S2).

### Attach before request

Serves E1.

1. At launch the first tab is at `about:blank`. The engine sends `Target.setDiscoverTargets` and
   then `Target.setAutoAttach` on the browser connection with `autoAttach`,
   `waitForDebuggerOnStart`, and `flatten` all true. The protocol description says auto-attach
   "attaches to all existing related targets as well", so the engine does not attach to existing
   targets by hand: the probe did both and received every exchange of the first tab twice. The
   engine keeps one CDP session per target, keyed by `targetId`.
2. For every page target it attaches to, the engine sends `Network.enable` with the first slice's
   buffer limits and `Network.setCacheDisabled` (decision D6), then
   `Target.setAutoAttach` on that CDP session so the tab's iframes and workers attach the same way,
   and only when every command has answered, `Runtime.runIfWaitingForDebugger`. A new tab or popup
   waits, before its first request, until the engine resumes it.
3. The probe confirmed the pattern for one popup: a `window.open` from the page produced a target
   attached with `waitingForDebugger: true`, and its document request appeared on its own CDP
   session. An Electron window that had not navigated never answered `Network.enable`
   ([stage-1 probe](2026-10-02-capture-engine-probe-spike.md), Results); in launched Chrome the
   paused popup did.
4. The engine records only page targets whose URL is `http` or `https`, with their iframes and
   dedicated workers. It resumes every other target without recording it, or leaves it out with
   the `filter` parameter of `Target.setAutoAttach` (experimental). The probe saw Chrome's own
   component extensions as `background_page` and `service_worker` targets with network traffic of
   their own.

`flatten`, `filter`, the `Network.enable` buffer limits, and its `enableDurableMessages` parameter
are marked experimental in `devtools-protocol` 0.0.1716261.

**The engine enables a closed set of domains:** `Target` on the browser connection, `Network` on
each recorded target, and `Page` only if the probe shows it changes nothing the page records
(open question P3). It never sends `Runtime.enable`, `Log.enable`, `Performance.enable`, or
`Debugger.enable`. When it needs page state, it creates an isolated world with
`Page.createIsolatedWorld` and calls `Runtime.evaluate` in that world's context. The probe ran
`Runtime.evaluate` without `Runtime.enable` in the main world; whether the isolated-world read is
observable by the page is P3.

**Each tab carries a "seen from the first request" flag** for its current navigation. The flag is
false when the engine attached after that navigation began. Such a navigation yields a Capture with
no Transaction Record and no Bound TLS Details, and the inventory says recording did not cover the
page.

What the guarantee does not cover. The inventory records each when it affects a Capture, except
as the schema 7 ruling below changes it:

- a response served from the HTTP cache, or a resource reused inside one page, which leaves no
  event ([stage-1 probe](2026-10-02-capture-engine-probe-spike.md));
- a response a service worker served (`fromServiceWorker` on `Network.Response`); the worker's own
  network request is on a target no tab owns (P9);
- a page restored from the back-forward cache, which loads nothing (P10);
- a page Chrome loaded speculatively before the Operator navigated to it, whose requests ran on
  another target (P10). The probe found pre-rendering off while the engine drives the browser and
  a prefetch recorded as an ordinary exchange, so schema 7 has no reason for it.

Whether a cross-site navigation keeps the tab's target and CDP session attached was not measured.
The [TLS spike](2026-05-17-chrome-debugger-tls-spike.md) estimate of 70 to 85 percent coverage
(section 3.4) was for `chrome.debugger` in the everyday browser, where a cross-origin navigation
detaches (section 3.3); it does not describe this arrangement either way. Validation measures it.

### Tabs, windows, and browser contexts

Serves E2, E5.

- **The engine owns every tab and window in the browser's default browser context**, whoever
  opened it. This is the Capture Scope ADR-0037 defines (:28-31), and it closes the gap ADR-0013
  found with a single tab, where a link that opened a new tab took the Operator out of scope.
- **Other browser contexts are refused.** `TargetInfo.browserContextId` names a target's context.
  A private window has its own cookie store, so a Persona stamp on its Capture would be false. The
  engine shows such targets in the panel, never records them, and never captures them.
- **Each tab keeps its own recording**, identified by `targetId`. A popup or a new tab gets its own;
  the opener is recorded in the `warcinfo` record.
- **A tab's Persona is its browser's.** The engine stamps the Persona from the browser profile the
  process was launched with, never from a picker.
- **Tabs whose URL is not `http` or `https`** (`chrome://`, `file://`, `devtools://`,
  `chrome-extension://`) are never captured.
- **Closing a tab discards its recording.** A crashed tab (`Inspector.targetCrashed`) discards its
  recording and cannot be captured until it loads again.

### From a session-long recording to one Transaction Record per Capture

Serves E1, E2, E3. ADR-0035 rules that a Capture's record holds "that tab's current navigation,
from its first request to the moment of Capture" (:28-32), and that two Captures of one page
overlap (:34-35).

1. **The navigation's start.** A tab's recording opens at a main-frame document request. Each
   `Network.requestWillBeSent` starts its own exchange, so redirect hops stay separate, as in the
   first slice. A login form that redirects to the page it signs in to is one navigation, so its
   `POST` is in that record (see [Credentials and passwords](#credentials-and-passwords)).
2. **Rollover.** When the main frame commits a new document, the recording of the previous one is
   discarded unless a Capture still needs it. A same-document navigation (the history API, a
   fragment change) does not roll over, so an application that changes routes without loading a
   document stays in one record; ADR-0035 accepts the overlap, and the size budget bounds it. A
   navigation request that never commits (a download, a `204`) leaves the current navigation in
   place. The engine learns of a commit from `Page.frameNavigated` if `Page` is enabled; otherwise
   the probe has to find a commit signal that needs no `Page` domain (P3).
3. **Bodies.** The engine fetches each body with `Network.getResponseBody` at
   `Network.loadingFinished`, as the first slice does, from the CDP session that reported the
   exchange. The engine holds bodies in memory under a per-tab budget taken from the first slice
   (first-slice spec, open question 3). A body over budget, or one the browser no longer held, goes
   into the inventory. Nothing about a page the Operator did not capture is written to disk. The
   main-process cost of fetching every body during an hour of browsing is open question P12.
4. **Credential values are replaced on arrival.** The engine replaces the four header values of
   ADR-0036 in its event handler, before it holds the exchange anywhere, in every header map,
   header text, and cookie list of any `Network` event. In `devtools-protocol` 0.0.1716261 those
   are:
   - `headers` on `Request`;
   - `headers`, `headersText`, `requestHeaders` ("Refined HTTP request headers that were actually
     transmitted over the network"), and `requestHeadersText` on `Response`, which arrives in
     `Network.responseReceived` and, for a redirect hop, as `redirectResponse` on
     `Network.requestWillBeSent`;
   - `headers` and `associatedCookies` on `Network.requestWillBeSentExtraInfo`;
   - `headers`, `headersText`, `blockedCookies`, and `exemptedCookies` on
     `Network.responseReceivedExtraInfo`, whose cookie lists hold cookie objects with their values
     and the raw `cookieLine`;
   - `headers` on `Network.responseReceivedEarlyHints`, the raw headers of a `103` response;
   - the request and response headers of a WebSocket handshake
     (`Network.webSocketWillSendHandshakeRequest`, `Network.webSocketHandshakeResponseReceived`),
     and a signed exchange's `outerResponse` and the `responseHeaders` of its header
     (`Network.signedExchangeReceived`).

   A unit test feeds the handler a synthetic event with a marker value in each of those fields
   and asserts that none survives. The first slice replaces before writing; in a running Capture
   Session the engine holds the recording for minutes, so the rule moves earlier.
5. **The cut.** The cut is the point in the browser connection's message stream at which the engine
   sends its first artifact command. An exchange belongs to the Capture if its
   `requestWillBeSent` arrived before the cut. One not finished when the artifacts are done is
   listed as in flight. A new document request that has not committed is in flight too, and the
   MHTML and screenshot are of the committed document. If a new document commits before every
   artifact is taken, the engine abandons the Capture and says so, instead of mixing artifacts from
   two documents. That the stream keeps order across a tab's CDP sessions is open question P11.
6. **Writing.** The engine writes the WARC once per Capture from the frozen recording, with the
   writer and record layout of the first slice. The recording continues; the next Capture of the
   same navigation overlaps this one, and each stays complete alone (ADR-0035:34-35).
7. **The main document must be there.** If the recording lacks the document request of the committed
   page, the Capture carries no Transaction Record and no Bound TLS Details, and the inventory says
   recording did not cover the page (E1).

**Cache.** A Persona's browser profile keeps its HTTP cache between Capture Sessions, unlike the
fresh partition of the background renderer, and a cached main document carries no Bound TLS
Details (TLS spike, section 2.3). The maintainer ruled on 2026-10-10 that the engine disables the
HTTP cache with `Network.setCacheDisabled` on every recorded target while a Capture Session runs,
with the `warcinfo` record saying so (decision D6).
#1499 made the same call for the Persona's Electron partition, which its scope creates with
`cache: false` "so a cached page cannot masquerade as a fresh render". Disabling the cache makes
every load go to the network: the server sees no conditional requests, and loads take longer, most
over Tor.

### The Capture sequence

For a clicked Capture of tab T:

1. Check that T is in the default browser context and its URL is `http` or `https`, and check the
   URL against the exclusion policy.
2. Run Scroll-to-load if the Operator asked for it, and keep its outcome for the inventory (the
   outcome CE-8 makes `scrollToLoadLazyContent` return). That function drives an Electron
   `WebContents` through main-world `executeJavaScript` (`backgroundRenderer.ts:215-262`), which a
   launched browser does not have, so stage 2 runs the same step and reset scripts over CDP with
   `Runtime.evaluate` in the isolated world and returns the same outcome. The overflow unlock
   (`SCROLL_UNLOCK_SCRIPT`, :166-180), which sets `overflow` to `visible` on the `html` and `body`
   elements to lift a consent wall's scroll lock, does not run in a launched browser: it is a style
   edit the page can observe, and the Operator is present to dismiss the wall. P3 covers what the
   scroll scripts change for the page.
3. Wait for network quiet on T's CDP sessions, bounded. The background renderer's
   `NETWORK_IDLE_MS` and `INITIAL_NETWORK_IDLE_MAX_MS` (`backgroundRenderer.ts:15-16`) are the
   starting values.
4. Mark the cut.
5. Take the screenshot with `Page.getLayoutMetrics` and `Page.captureScreenshot` with
   `captureBeyondViewport`, with the first slice's caps, trim, and inventory facts. The width is
   the Operator's window width, where the background renderer uses a fixed 1,280-pixel viewport
   (`backgroundRenderer.ts:14`); the inventory's dimensions say which. `captureBeyondViewport`
   briefly lays out the page the Operator is looking at again, a trade-off #635 lists for the
   extension too.
6. Take MHTML with `Page.captureSnapshot` (experimental). Whether its output matches what
   `wc.savePage` writes for the same page is open question P24.
7. Read the page text in an isolated world. The background renderer reads it in the main world
   (`backgroundRenderer.ts:521-523`).
8. Write the WARC from the frozen recording.
9. Take the PDF with `Page.printToPDF`, last, after the record is frozen, because printing fires
   `beforeprint` and starts requests ([stage-1 probe](2026-10-02-capture-engine-probe-spike.md),
   Results). `Page.printToPDF` is unavailable over Electron's debugger, so the background renderer
   uses `webContents.printToPDF`; in a windowed Chrome tab it returned data in the probe.
10. Hand everything to `admit` with a launched route, `method: 'launched'`, the Persona stamp, the
    Egress fields, and the browser product and version.

The Capture records Bound TLS Details from the main document's `securityDetails`, as the first
slice does, when T's navigation was seen from its first request and the document did not come from
the cache. The TLS Cert Chain re-fetch stays the floor while the Egress is Direct and is skipped,
with `tlsSkipped`, otherwise (ADR-0034:88-92, ADR-0032:63-66).

Admission is today's: `admit` applies the exclusion policy to the URL it is handed, which the
launched route sets to the committed URL; the Active Case receives the Capture; and #597 (the
ignore default) still applies to clicked Captures (ADR-0037:65-67). Whether the manual dedup
window applies to the launched route is part of open question Q1.

### Credentials and passwords

Serves E3. Decision D3, ruled 2026-10-10.

ADR-0036 replaces four header values. In the background renderer nobody submits a sign-in form. In
a launched browser the Operator signs in, and the first slice records request bodies, fetching
long ones with `Network.getRequestPostData`. A sign-in form's `POST` is the first request of the
navigation that lands on the signed-in page (step 1 above), and a sign-in sent by `fetch` is a
request inside the current navigation, so a Capture of that page would hold the Persona's password
in its Transaction Record. ADR-0030 rules that "Passwords are never stored" (:63), and an export
carries the record to people the Operator does not control (ADR-0036:32-35).

The network layer cannot tell a password field from any other form field. The ruling: the engine
records no request body in a `launched` or `launched-passive` Transaction Record, and the
inventory counts the withheld bodies (ruled 2026-10-31; no request id or URL enters the
Manifest). The cost is that a search or form submission sent by `POST` loses its body.

The ruling needs an ADR before step 4, because withholding bodies changes what a Transaction
Record holds: ADR-0035 gives the record the tab's navigation "from its first request to the
moment of Capture" (:28-32), ADR-0036 replaces four header values only, keeps tokens in a body in
the record, and makes its list part of the Evidence Profile (:26-30, :43-46), and `CONTEXT.md`
says "a secret in any other header, a URL, or a body stays in the record" (:58). That ADR amends
ADR-0035, ADR-0036, and that glossary clause.

### Browser profiles per Persona

Serves E5, S2, S3.

```text
<userData>/launched-browsers/
  persona-<personaId>/<product>/   browser profile of one Persona for one product
  session-<uuid>/<product>/        throwaway browser profile for a Capture Session with no Persona
```

- **One browser profile per Persona per product** (decision D8, ruled 2026-10-10). ADR-0034 says
  "one per Persona" (:55). A separate `--user-data-dir` gives a separate cookie store, cache, local
  storage, service workers, history, and browser process. The product level keeps Chrome and Edge
  from opening each other's profile; whether they could safely share one was not checked, so this
  reads ADR-0034 as one per Persona for each browser.
- **No Persona means a throwaway browser profile** (decision D9, ruled 2026-10-10). A Capture
  Session without a Persona gets a fresh directory, deleted when the Capture Session ends and swept
  at startup, the way the background renderer uses a fresh `recapture-<uuid>` partition per
  render. If the Operator signs in by hand there, no Persona is recorded, and the record still
  shows that a `Cookie` header was sent, with its value replaced (ADR-0036).
- **Deleting a Persona deletes its browser profiles** after clearing the partition, in the same
  serialized step as `clearPersona` (`personaSessions.ts:113-119`), before the soft delete
  (ADR-0030:43-45). While the Persona's browser runs, Birdbrain asks the Operator to end the
  Capture Session first. The startup orphan sweep extends to `launched-browsers/persona-*`, with
  the same guard it uses for partitions (:135-139).
- **Browser profiles stay out of exports.** No browser profile is part of an Evidence Package, a
  Case Archive, or a database snapshot.
- **What is not isolated.** Two Personas share the machine (screen, fonts, hardware, time zone),
  the Egress (one setting per installation, ADR-0032:67-68), and the browser build. A site can
  link them through those. The threat-model delta (#546) has to say so; ADR-0030 already lists
  operating-system isolation as not promised (:94-96).
- **Chrome features that carry a Persona out of its browser profile** (decision D15, ruled
  2026-10-10: launched browser profiles disable sync and password saving).
  `--disable-sync` stops syncing to a Google Account. Setting `credentials_enable_service` to
  `false` stops Chrome offering to save the Persona's password
  (`components/password_manager/core/common/password_manager_pref_names.h:42-43`); the engine
  writes it into the browser profile's preferences before the first launch, and whether Chrome
  keeps a value written that way was not checked (P15).
- **The key store.** Chromium encrypts cookie values with a key it gets from the operating system:
  the login keychain on macOS, a `libsecret` record or a fixed passphrase on Linux, and DPAPI or
  App-Bound Encryption on Windows
  ([t3code browser profiles research](2026-09-19-t3code-browser-profiles-research.md), lines
  223-230). Chrome for Developers says a non-default data directory "uses a different encryption
  key". On Linux, Chromium falls back to the `basic` store when the store it asked for or detected
  is not available, and calls `basic` "the plain text store"
  (`docs/linux/password_storage.md:32-35`). This is the launched-browser counterpart of the #414
  warning that `getPersonaStorageState` backs for the partition (`personaSessions.ts:196-198`).
  Birdbrain cannot read which store the launched browser chose. Under the ruling on decision D17,
  stage 2 measures on Linux which key store the launched browser picks (P16) before adding any
  plaintext warning.
- **The partition's at-rest protection is unverified.** ADR-0030 (:62-65) and the comment above
  `partitionForPersona` say the `safeStorage` key protects the partition's cookies. Electron's
  `cookieEncryption` fuse defaults to disabled and Birdbrain does not set it, so the #414 warning
  may not describe the partition either
  ([browser cookie import research](2026-10-10-browser-cookie-import-research.md), "What adopting
  it changes"). Under the maintainer's 2026-10-10 ruling, the roadmap's CE-AR brief checks a
  running build first. If the partition's cookies are not encrypted at rest, CE-AR corrects
  ADR-0030's at-rest sentence, the persona plan's decision 8, and that comment to state what is
  true. Enabling the fuse stays its own change (#88).

### Cookie seeding from the Persona import

Serves E5, S2, S3.

ADR-0034 seeds both of a Persona's browser sessions "from the same cookie import" (:75-77).
ADR-0030 rules that cookie files are read, loaded, and discarded (:62-63). The file is gone by the
time a browser launches, so when the browser profile is seeded was decision D7. The maintainer
ruled on 2026-10-10 for option (a):

- **(a) One import seeds both stores (ruled).** The Electron partition is seeded as today. Each
  configured product's browser profile is seeded through a launch with `--no-startup-window`, which
  Chromium describes as "Does not automatically open a browser window on startup"
  (`chrome_switches.cc:481-483`), followed by `Storage.setCookies` and `Browser.close`. If no
  supported browser is configured, the import seeds the partition and says the browser profile was
  not seeded; a later import seeds it. This keeps S2 whole: the engine never reads a cookie value
  back out of either of the Persona's stores. Whether the pipe starts without a window, and whether
  `Browser.close` writes the cookies to disk, was not measured (P14).
- **(b) Seed the browser profile from the partition at launch (not taken).** If the Persona's last
  import (`Persona.lastImportAt`, `src/shared/types.ts:293`) is newer than the import the browser
  profile was last seeded from, the engine reads the partition's cookies with Electron's
  `session.cookies.get` and writes them with `Storage.setCookies` before the first tab is resumed.
  This seeds a product installed after the import without a second import, at the cost of reading
  cookie values back out of the partition, and it carries any change a background render made to the
  partition after the import (#1499).
- **(c) Each store has its own import (not taken).** Simplest, and the Operator needs the cookie
  file twice.

Under option (a), an import for a Persona whose launched browser is running asks the Operator to
end the Capture Session first, as deletion does. Chromium runs one browser process per data
directory ("no more than one copy of the application can be running at once with a given data
directory", `chrome/browser/process_singleton.h:39-42`), so the seeding launch cannot start on a
browser profile that is in use.

**An installed browser as a second source.** With D7 the maintainer asked that Birdbrain detect the
browsers installed on the machine and import cookies from them, as t3code does. The
[browser cookie import research](2026-10-10-browser-cookie-import-research.md) compared three
options, and on 2026-10-10 the maintainer adopted its second, which
[ADR-0052](../adr/0052-import-persona-cookies-from-installed-browsers.md) records:

- Birdbrain detects installed browsers and offers each as a source for the one import of option
  (a). Cookie files stay as the fallback.
- Firefox comes first. It stores cookie values as plaintext, and `better-sqlite3`, which Birdbrain
  already has, reads them, so Firefox needs no new dependency. Chromium browsers on macOS and Linux
  follow. The key readers the Chromium phase needs, a keychain binding or `/usr/bin/security` on
  macOS and a `libsecret` helper built for each architecture on Linux, are a dependency decision
  that is still open (the research, "Maintainer rulings (2026-10-10)").
- The Operator picks sites one by one, with none ticked by default. The importer filters by host
  in SQL, so it never decrypts a cookie the Operator did not pick. It imports a whole browser
  profile only when the Operator states that the source browser profile serves this Persona alone.
- Birdbrain never works around App-Bound Encryption, so Chrome and Edge on Windows stay file-only.
- On macOS, Birdbrain tells the Operator to pick Allow, not Always Allow, in the keychain prompt,
  because Always Allow gives Birdbrain a lasting grant to that browser's key.

The ruling settles neither whether the browsers must be closed during an import nor how the
importer reads the source database. This design takes both answers from the research:

- The source browser and the Persona's launched browser are both closed. The seeding launch cannot
  start on a browser profile that is in use (above), and Firefox holds an exclusive lock on its
  cookie database. For a Chromium source the research cites only t3code's practice, and this
  design keeps that practice (the research, "Platform by browser").
- Option 2, as the research describes it, reads a temporary copy of the closed source database,
  which t3code makes with `VACUUM INTO`. Until Birdbrain deletes the copy, it holds the cookie
  values of every site in the source profile on disk, as plaintext for a Firefox source. ADR-0030
  says the "only copy of a cookie value is Chromium's own store" (:62-65), and ADR-0052 amends
  that sentence to cover the copy.

A browser import reads cookie values out of the source browser's store, which is none of the
Persona's stores, so S2 still holds and S3 states the exception. ADR-0052 records the ruling and
amends ADR-0030 (:47-54, :62-65), the persona plan (:85-87, :187-189, :197-200), and ADR-0034
(:75-77). A new ticket under #541 builds the browser import and is grilled with the maintainer
before it is `ready-for-agent`, and #546, #543, and #1498 take the questions ADR-0052 raises. No
browser import ships before the partition's at-rest wording is true (see
[Browser profiles per Persona](#browser-profiles-per-persona)). The
[Persona cookies at-rest assessment](2026-10-11-persona-cookies-at-rest-assessment.md) made it
true on 2026-10-11: it found the partition's cookie values stored as plain text and corrected
ADR-0030 and the persona plan's decision 8 to say so.

The engine maps `hostOnly` for CDP, which reads `domain` differently from Electron. Electron turns
any `domain` into a subdomain cookie, so `importCookies` passes no `domain` for a host-only cookie
and the file's `domain` otherwise (`cookieFiles/types.ts:5-12`, `personaSessions.ts:88-98`).
`Storage.setCookies` makes a subdomain cookie only when `domain` starts with a period; without one
it clears the domain, and the cookie becomes host-only (`MakeCookieFromProtocolValues`,
`content/browser/devtools/protocol/network_handler.cc:461-474`). The Netscape parser keeps the
domain as the file wrote it and takes `hostOnly` from the include-subdomains column
(`cookieFiles/netscape.ts:35-53`), so a row for `example.com` with `TRUE` in that column arrives
with no leading period. Copying `importCookies`' mapping would narrow that cookie to one host in the
launched browser while the partition keeps it as a subdomain cookie. The engine therefore passes
`domain` with a leading period for a cookie whose `hostOnly` is false, and `url` with no `domain`
for a host-only cookie. `sameSite` maps to the protocol's `Strict`, `Lax`, and `None`, and
`unspecified` leaves it unset. A cookie the browser refuses joins the rejection list as
`rejected-by-session`. Cookie values pass through Birdbrain's memory; the engine never logs them or
writes them to a file, and neither does the importer, apart from a browser import's temporary copy
(above). Per-store counts on the `personas` row would need a migration and take the migration lane.

A cookie with no expiry is a session cookie in the launched browser too, and may be gone after the
browser closes (P14). A sign-in by hand in the launched browser changes that browser profile only;
no cookie is copied back to the partition. The two stores then differ, which ADR-0034 accepts
("A Persona's two sessions can drift apart", :147). The Persona screen states both limits.

### Egress

Serves E4. ADR-0034: "A launched browser has to follow the Egress of ADR-0032 and fail closed"
(:144-145).

**Fixed at launch.** The proxy and WebRTC switches apply for the browser's life, and each Capture
records the Egress its browser launched with: the kind, the Operator's label, and the user agent,
never the proxy host or port (ADR-0032:69-79). Changing the Egress setting while a Capture Session
runs in a launched browser ends that Capture Session first, after the Operator confirms. A browser
that kept a Direct launch after the setting moved to a proxy would send directly while the Egress
is not Direct, which ADR-0032 rule 1 forbids (:41-45).

**Before launch.** While the Egress is not Direct, the engine opens a TCP connection to the
configured proxy. If nothing accepts it, the engine does not launch and names the proxy, as #1695's
acceptance criteria require of a background capture whose proxy is stopped. No request reaches a
target site for this check.

**Switches.** `--proxy-server` takes a SOCKS5 or HTTP proxy with no `direct://` fallback, so an
unreachable proxy fails each request instead of exposing the Operator (Chromium `net/docs/proxy.md`,
quoted in the [identity-masking research](2026-09-28-recapture-identity-masking-research.md), lines
215-227). Through the probe's SOCKS5 fixture, Chrome sent host names, not addresses, so the proxy
resolved them. `--webrtc-ip-handling-policy=disable_non_proxied_udp` maps to Chrome's
WebRTC preference; the probe page gathered one UDP host candidate for Interactive Connectivity
Establishment (ICE) without it and none with it. Content's `--force-webrtc-ip-handling-policy`
(`content_switches.cc:851-853`) is not used: a code search of Chromium found it read only by
`content_shell` and headless, which this spec could not confirm (P6). Chromium's implicit bypass
keeps requests to `localhost` and link-local addresses off the proxy unless the bypass list
carries `<-loopback>` (identity-masking research, lines 225-227); that traffic stays on the
machine or its local link. Tests add `<-loopback>` so a loopback fixture is reached through the
fixture proxy; a shipped launch does not.

**Checks, because a preference can be overridden.** Chromium ranks preferences from mandatory
policy and from extensions above command-line ones (`components/prefs/pref_value_store.h:66-74`).
An enterprise policy, or an extension in the browser profile, can therefore replace the proxy or
the WebRTC policy. The engine checks the effect:

- **WebRTC.** Before showing the first tab, the engine gathers ICE candidates on it with no ICE
  servers, as the probe page did, from an isolated world on that tab's `about:blank`. The probe
  gathered them from a loaded `http` page instead, so P6 asks whether the result matches. A
  candidate while the Egress is not Direct means the policy is not in force: the engine closes the
  browser and says so.
- **Remote endpoint.** Through the SOCKS5 fixture, CDP reported the proxy's own address and port as
  `remoteIPAddress` and `remotePort` on every response sent through it. While the Egress is not
  Direct, a recorded response whose remote endpoint is present, is not loopback or link-local, and
  differs from the proxy means a request bypassed it. The engine closes the browser, ends the
  Capture Session, and tells the Operator. Captures already taken stand. This check sees only the
  tabs the engine records, and an HTTP proxy was not measured (P13).
- **Extensions.** The engine watches for extension targets in the browser profile. While the
  Egress is not Direct, it warns in the Capture Session panel when one appears, and Birdbrain does
  not refuse Captures (decision D14, ruled 2026-10-10).

**Never in the record.** While the Egress is not Direct the remote endpoint is the proxy's, so the
engine writes no `WARC-IP-Address` and no endpoint into the inventory then (ADR-0032 rule 5; brief
CE-7). Under Direct the probe saw the server's own address and port.

**The browser's own traffic.** Within seconds of launch on a fresh Chrome profile, the probe's proxy
saw connections to `clients2.google.com`, `safebrowsingohttpgateway.googleapis.com`,
`accounts.google.com`, `mtalk.google.com` on port 5228, and other Google hosts. With the Egress not
Direct, all the traffic the fixture saw went through it; the probe cannot show that nothing went
around it (P13). Under Direct this traffic leaves from the Operator's connection, as it does from
any Chrome, and the launched-browser docs say so.

**Other paths.** Starting a Capture Session while the Egress is Direct and no VPN is seen shows the
CE-4 warning, which says Birdbrain can see the machine's network path, not the browser's
(ADR-0032:102-104).

**Location.** A granted geolocation permission reveals where the Operator is whatever the Egress.
The engine denies `geolocation` for all origins with `Browser.setPermission` (experimental) when it
sets up the browser (decision D16, ruled 2026-10-10).

### What a page can tell about the browser

Serves S4 and the "do not disguise the browser" rule of ADR-0032.

- The user agent and client hints are the product's own. The engine changes neither.
- `navigator.webdriver` depends on the transport (see
  [The browser connection](#the-browser-connection)).
- `window.chrome` had the keys `loadTimes`, `csi`, and `app` in every probe run. The persona spike
  measured an empty object in the Electron renderer.
- The engine enables `Network` on each recorded target, and `Page` only if P3 clears it. The
  first-slice probe saw no page-visible change from `Network` in Electron; nothing measured `Page`
  or a launched Chrome beyond the two facts above. The engine never enables `Runtime`, the domain
  the persona spike ties to a known debugger signal.
- `--enable-automation` raises Chrome's "controlled by automated test software" infobar
  (`infobar_utils.cc:86-89`, :132-134), and the engine never passes it. Whether any other banner
  appears in this configuration was not observed (P19).
- The `warcinfo` record names the transport, so a reviewer of a challenge page knows what
  `navigator.webdriver` said.

### The Operator's capture trigger

Serves E2, E5, E6.

- **A Capture control in Birdbrain**, in the Capture Session panel. It names the tab it will
  capture, with title, URL, and Persona, before the Operator clicks.
- **A keyboard shortcut** registered with Electron's `globalShortcut`, which works while the
  browser has focus. Electron 44.5.1's type documentation warns that GNOME 50 rejects
  `globalShortcut` binds through its portal "with no error surfaced to the app" when the app ID
  does not resolve (`electron.d.ts` in the `electron` package, lines 1723-1725), so Linux desktops
  are open question P17.
- **Which tab.** The engine reads `document.visibilityState` and `document.hasFocus()` in an
  isolated world on each recorded tab. With one window, the visible tab is the one in front; with
  the browser focused, the focused tab is. When more than one tab qualifies, or none, the shortcut
  opens the panel's tab picker. The engine never guesses.
- **Rejected:** a button or overlay drawn into the page, which changes the DOM that becomes the
  MHTML, the hazard the
  [evidence-affecting paths assessment](2026-07-31-evidence-affecting-paths-assessment.md) lists
  for `extension/src/toast.ts` (line 189); and a Birdbrain extension in the browser profile, which
  puts extension code beside the evidence, the thing ADR-0034 removes.

A capture trigger comes only from the Operator's action in Birdbrain or from a running Capture
Session's passive rule. A page cannot trigger one. A Capture goes to the Capture Session's Active
Case at the moment of the trigger.

### Selector matching and passive capture

Folds in #600. Serves E6, E8.

**Matching uses the ingest rule.** After a main-frame document commits, loads, and the network
goes idle, the engine reads `document.body.innerText` in an isolated world and tests each enabled
Active Case Selector with `selectorMatchesText`, moved out of `selectorRepo.ts` into a module both
import so the live check and the Selector Lifecycle cannot drift. A Selector then means the same
thing in the launched browser and in a Case search. The extension's in-page matcher is not reused:
it runs regular expressions in the page with no budget and highlights by editing the DOM. Matching
runs where extraction runs after CE-10, the utility process of the ruling on #598, because a
200 ms budget per Selector on a large page is main-process time.

**A timeout has to be visible.** `safeRegexTest` answers false for a pattern that does not parse,
for a budget that expires, and for no match alike (`safeRegex.ts:10-13`, :38-40);
`selectorMatchesText` "Never throws" (`selectorRepo.ts:143-145`); and `matchIgnoredUrl`, which
`matchCaseExclusion` reaches, takes the same test as a parameter (`src/shared/urlPatterns.ts:73-95`,
`exclusionPolicy.ts:40-49`). No caller can tell a timeout today. Stage 2 changes `safeRegexTest`
so it reports a timeout apart from no match, and the moved `selectorMatchesText` and
`matchCaseExclusion` pass that answer on. The live check and the Selector Lifecycle use the same
changed functions, so they still cannot drift. The extension calls `matchIgnoredUrl` without the
sandbox (`extension/src/background.ts:695`), so the change keeps that call's answer as it is.

**No highlights in the page.** The Capture Session panel lists the Selectors that matched the tab
in front instead. That live result writes no Persisted Match: Persisted Matches still come from
ingest (`runPostCaptureWork`, `captureLifecycle.ts:745`), so the Selector Lifecycle stays the only
writer of `selector_matches`. If the live text matched and the Extracted Text does not, the Capture
exists with no Persisted Match.

**Passive capture.** During a running Capture Session the Operator chooses "every page that loads"
or "pages a Selector matches" (ADR-0037:33-36). Then:

- one `launched-passive` Capture per committed main-frame navigation, taken after load and network
  idle, through the Capture sequence without Scroll-to-load or PDF. Printing fires `beforeprint`
  and starts requests in a page the Operator may be reading (stage-1 probe), and scrolling moves
  that page; the inventory gives the reason each is absent;
- the Case's exclusion policy is checked with `matchCaseExclusion` on the committed URL before
  anything is collected, and `admit` checks again. For passive capture a pattern that times out
  counts as a match, so the page is skipped, which needs the timeout answer above (decision D13,
  ruled 2026-10-10: clicked Captures keep today's behavior, and the ruling amends ADR-0037
  (:35-36) and #600);
- a page on a loopback or private address is not passively captured, using the shared address
  classification CE-2 (#1726) introduces;
- every passive Capture carries a Transaction Record (ADR-0037:33-36). If the tab's recording is
  incomplete for E1, the engine skips the page instead of taking a passive Capture without one;
- the engine never brings a tab to the front. A passive Capture of a background tab takes what that
  tab can give; whether a screenshot works there is P2;
- Captures queue per tab, with a small global limit so a burst of tabs cannot stall ingest; the plan
  sets the numbers after CE-10;
- each skip, with its reason, goes to the capture activity feed as a `skipped` event, the pattern
  `admit` already uses for an excluded URL (`captureLifecycle.ts:1000-1009`);
- stopping the Capture Session stops passive capture at once (#600). Queued passive Captures are
  dropped; one already collecting finishes, because its moment of Capture fell inside the Capture
  Session.

A route change inside an application (step 2 of the recording section) triggers no passive
Capture. The panel shows that the route changed and was not captured, so the gap is visible.
Whether passive capture should react to it, re-check a feed that grows after load, or skip a URL it
captured a minute ago is open question Q1; #600 brings back the removed dedupe control only if it
governs something real.

**Cost.** Passive capture pays extraction once per page browsed (ADR-0013:62, ADR-0037:63-64).
While extraction blocks the main process, the engine's message handling waits: new tabs stay
paused longer, and Chrome's buffers have longer to drop bodies before the engine fetches them.
CE-10 lands before any stage-2 code brief for that reason.

### Capture Methods `launched` and `launched-passive`

Folds in #599. Serves E6.

- `CAPTURE_METHODS` gains `launched` and `launched-passive`. A verifier release that accepts each
  ships before any build writes it (ADR-0023 sequencing). Decision D5, ruled 2026-10-10: the
  verifier learns `launched-passive` in a release before #600's writer merges, and the glossary
  and reporting surfaces change with #600. #599 says the value "lands with the restoration, not
  before", and needs a clarification to match.
- `launched` is operator-witnessed. `launched-passive` is never described as operator-witnessed on
  any surface: `report.html`, `certification.html`, `VERIFY.md`, and the app's provenance display
  (#599).
- The Capture Scope for both is the launched browser (ADR-0037:28-31). The Manifest Entry states it
  through the method, as a boundary the engine enforced, never as an Operator declaration. That
  statement is Birdbrain's, signed with the installation's key: it shows that software enforcing
  the scope wrote the entry, and it does not constrain an Operator who holds the key
  (`SECURITY.md`).
- `persona-window` is not added. ADR-0034 withdrew it (:79-80).

### Persona wording

ADR-0030 gave each mechanism its own wording (:47-54). ADR-0034 withdrew `persona-window`, so
"captured in a persona window" has no Capture left to describe. The maintainer confirmed this
wording for Capture detail, `report.html`, `certification.html`, and `VERIFY.md` on 2026-10-10 as
proposed, with the `background` and legacy `extension` wording unchanged (decision D11):

| Capture Method | Wording when a Persona is stamped | What Birdbrain knows |
| --- | --- | --- |
| `background` | persona session used (ADR-0030, unchanged) | Birdbrain chose the partition |
| `launched` | captured in the Persona's launched browser | Birdbrain chose the browser profile; the Operator was present |
| `launched-passive` | taken without a click in the Persona's launched browser | Birdbrain chose the browser profile; nobody clicked |
| `extension` (legacy) | persona declared by operator (ADR-0030, unchanged) | The Operator's claim, unchecked |

Each wording states which Persona's session or browser profile Birdbrain used. None states which
account the page showed: an Operator can sign in or out by hand in the launched browser, and the
stamp does not follow that. Export wording stays with #543, and CE-S3 sets the `companion`
wording. The label rules of ADR-0030 are unchanged: the label is frozen at acquisition (:40-41).

`CONTEXT.md` changes with the code that makes each clause true:

- the Capture Method entry, whose `launched` clause, "a Transaction Record when a Capture Session
  is running" (:78), narrows under the ruling on decision D20;
- the Capture Session entry: a launched browser runs only inside a Capture Session (D20);
- the Capture Lifecycle entry, whose admission covers "a request from any extension route" (:74)
  and gains the launched route;
- the Transaction Record entry, whose "a secret in any other header, a URL, or a body stays in
  the record" (:58) changes with the ADR the ruling on decision D3 needs;
- the Persona relationship line, which gains the launched mechanism beside the background and
  extension ones;
- the gaps in decision D18.

### Manifest, schema, and verifier

New optional fields on the `capture` entry, each omitted when absent so existing chain hashes are
unchanged, and each learned by the verifier in a release before any build writes it:

- the `launched` and `launched-passive` method values;
- the browser product and version from `Browser.getVersion`, and the product family the engine
  launched (E7, decision D12, ruled 2026-10-10: sign all three). Today the signed entry names no
  browser while the Egress is Direct, and two products can send the same user agent. The row can
  keep it in `browser_version` with no migration;
- for `launched-passive`, which rule took it: every page, or a Selector match (decision D12,
  ruled 2026-10-10). Which Selectors matched stays on the row (`selector_matches`), out of the
  signed entry, because a pattern can reveal what the investigation is looking for;
- the transport, only if the port fallback of decision D1 is built, because the ruling requires
  the signed record of a port-mode Capture to state it. Step 2's release does not carry this
  field; a later verifier release learns it before any build in port mode writes it;
- the inventory values stage 2 adds, as ruled on 2026-10-31 (see
  [Decisions and rulings](#decisions-and-rulings)): the absence reasons "recording did not cover
  the page" and "restored from the back-forward cache" on the Transaction Record and "not taken
  for a passive Capture" on the PDF; a count of the exchanges a service worker served and a count
  of the request bodies the engine withheld; and a flag that the HTTP cache was disabled. The
  rulings dropped "tab not visible" and "loaded speculatively", and made "served by a service
  worker" and "request body withheld" counts rather than reasons. CE-5's inventory closed its
  reasons at `not-taken` and `failed`, so these land at schema 7 (#1830); a released verifier
  cannot be recalled, and a strict schema rejects a value it does not know.

The Persona fields come from #1498, without `persona-window`, at schema 7 beside the values
above (ruled 2026-10-31). The Egress fields exist at schema 5 (`schemas.ts:502-505`). Bound TLS
Details, the WARC and PDF hashes, and the inventory come from CE-5.

## How each failure is recorded

| Failure | What the engine does | Where it shows |
| --- | --- | --- |
| No supported browser, or an unknown product | Does not start a Capture Session | Message to the Operator |
| The debugging connection does not answer (for example, an enterprise policy) | Kills the browser | Message naming the cause; diagnostic log |
| The proxy does not accept a connection before launch | Does not launch | Message naming the proxy |
| The proxy fails during a Capture Session | Chrome fails the requests | The failed exchanges in the inventory; a Capture of the error page is what the browser showed |
| A response arrives from an endpoint other than the proxy while the Egress is not Direct | Closes the browser and ends the Capture Session | Message to the Operator; diagnostic log without the URL |
| The WebRTC check finds a candidate while the Egress is not Direct | Closes the browser before showing it | Message to the Operator |
| `Network.enable` fails on a tab | Marks the tab unrecorded | A clicked Capture carries no Transaction Record and the inventory gives the reason; a passive Capture is skipped |
| The document request is missing from the recording | No Transaction Record, no Bound TLS Details | Inventory reason |
| A new document commits while a Capture is being taken | Abandons the Capture | Capture activity feed and panel |
| A body over budget, no longer held, or not fetched | Exchange kept without body | Inventory, as in the first slice |
| A response from the cache or the back-forward cache | No exchange or a partial one | Inventory reason |
| A response a service worker served | Exchange kept, without the server address | Inventory count of such exchanges (schema 7 ruling) |
| A credential header | Value replaced on arrival | Inventory lists the header names (ADR-0036) |
| A request body | Withheld (decision D3) | Inventory counts the withheld bodies (schema 7 ruling) |
| An exclusion pattern or Selector check times out on a passive page | Skips the page, once `safeRegexTest` reports a timeout apart from no match | `skipped` event in the capture activity feed |
| A tab in a private window | Refuses the Capture | Panel |
| A tab crashes | Discards its recording | Panel |
| The browser exits or the connection closes | Discards the browser's recordings and stops its passive capture; the Capture Session keeps running (decision D20) | Message to the Operator; Captures already taken stand |
| Birdbrain exits while the browser runs | Cannot reattach to a pipe. If the browser is still running at the next start, asks the Operator to close it | Message to the Operator |
| Cookie seeding refuses a cookie | Counts it | Import result per store, `rejected-by-session` |

No failure at the level of a Capture Session writes a Manifest Entry. Each Capture's own inventory
states what that Capture lacks, which is what an export carries.

## Measured for this spec

A throwaway probe, reproduced in the [appendix](#appendix-the-probe), ran on 2026-10-10 with
Google Chrome `150.0.7871.181` on Linux (WSL2) under `xvfb-run`. The CDP client ran under Electron
44.5.1's Node (`ELECTRON_RUN_AS_NODE`). Each run started Chrome on a fresh `--user-data-dir`,
attached as in [Attach before request](#attach-before-request) (plus an explicit attach to the
existing page, which doubled its events), loaded a page from a local HTTP server on `127.0.0.1`,
read what the page recorded about itself, and opened a popup with `window.open`. Runs with a proxy
used a SOCKS5 fixture server in the same script, with `--proxy-bypass-list=<-loopback>` so that
requests to the loopback page went through it.

| Configuration | `navigator.webdriver` | Second client accepted | ICE candidates | Remote endpoint CDP reported |
| --- | --- | --- | --- | --- |
| Fixed port 9333 | `false` | Yes | One UDP host candidate (a `.local` host name) | The server |
| Port 0 | `true` | Yes | One UDP host candidate | The server |
| Pipe | `true` | Not applicable: no port | One UDP host candidate | The server |
| Fixed port, SOCKS5 proxy | `false` | Yes | One UDP host candidate | The proxy's address and port |
| Fixed port, SOCKS5 proxy, WebRTC policy | `false` | Yes | None | The proxy's address and port |

In every run the popup's target was attached with `waitingForDebugger: true`, its document request
appeared on its own CDP session, and `window.chrome` had the keys `loadTimes`, `csi`, and `app`. In
one fixed-port run and one pipe run, `Page.captureSnapshot` (MHTML), `Page.captureScreenshot` with
`captureBeyondViewport`, and `Page.printToPDF` each returned data.

What this does not show:

- Edge, Brave, Chromium, Windows, macOS, or another Chrome version.
- TLS, HTTP/2, or HTTP/3: the fixture was plain HTTP on loopback.
- A cross-site navigation, a service worker, a back-forward cache restore, or a speculative load.
- That no connection left around the proxy. The fixture logs what reached it; a net log in a
  network namespace with only loopback would show what did not.
- An HTTP proxy, or whether Chrome shows any banner in this configuration.
- Anything beyond one run per configuration, on one machine.

## Risks

- **Pages can see the launch.** With the pipe, every page reads `navigator.webdriver === true`.
  Whether the four social platforms challenge a launched browser more often than the Electron
  renderer the persona spike measured is not known, and a live account probe is the maintainer's to
  authorize. Under the ruling on decision D1, the app counts bot-challenge refusals in launched
  browsers, and that count is one trigger for building the port fallback.
- **The browser updates itself.** Chrome, Edge, and Brave update outside Birdbrain's release
  cycle, and the engine relies on commands the protocol marks experimental (`Page.captureSnapshot`,
  the `Network.enable` buffer limits, `flatten`). The probe result holds for the versions it ran
  on. Each Capture names its browser and version. Under the ruling on decision D23, CI runs the
  suite against a pinned Chrome for Testing build, and a person reruns it by hand against Edge,
  Brave, and branded Chrome when they update.
- **The Egress can be routed around** by a policy or an extension (see [Egress](#egress)).
- **The Operator can mistake one browser for the other.** The launched Chrome has the same icon as
  the everyday Chrome. A Capture taken in the wrong browser has the wrong method and, possibly, the
  wrong Persona. The UI brief that the ruling on decisions D19 and D22 asks for covers telling the
  two apart.
- **Main-process load.** CDP events for every request of every tab reach Birdbrain while a Capture
  Session runs, whether or not anything is captured.

## Validation

[ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md) requires known-answer validation for an
evidence-affecting method, and ADR-0034 makes each pairing of engine and browser a separate one
(:146). The suite runs per pairing before Birdbrain offers that pairing, against local fixture
servers reached through CE-2's test-only loopback allowance:

- **The first slice's known answers hold in a launched browser:** payload digests for plain and
  `gzip` bodies, a redirect chain, cached, failed, cancelled, and over-budget exchanges, a reader
  that is not the writer, and Bound TLS Details matching a TLS fixture's certificate.
- **Attach before request.** For the first tab, a typed navigation, a `target=_blank` link, a
  `window.open` popup, a new tab, a redirect chain, a cross-site iframe, and a cross-site
  navigation, every document request the fixture logged appears in its tab's record.
- **One CDP session per target.** The fixture's request count equals the record's exchange count.
- **The cut.** An endpoint that holds its response open is listed as in flight; a request started
  after the cut is absent; two Captures of one navigation overlap and each passes Package
  Verification alone; a Capture after a new navigation holds none of the previous navigation's
  exchanges; a tab whose navigation began before attach yields a Capture with no Transaction Record
  and the reason in the inventory.
- **Credentials.** A fixture cookie, an `Authorization` value, and a password field's value appear
  in no file Birdbrain wrote: WARC, inventory, logs, or temporary files. The test searches for the
  known values. The synthetic-event unit test of step 4 in
  [the recording section](#from-a-session-long-recording-to-one-transaction-record-per-capture)
  passes.
- **Egress.** Every exchange's remote endpoint is the SOCKS5 fixture's; with the proxy stopped,
  launch is refused and the target's log shows no request; the WebRTC check finds no candidate; a
  net log in a loopback-only network namespace shows no socket to any address but the proxy. That
  run uses `unshare -rn sh -c 'ip link set lo up && xvfb-run --auto-servernum pnpm test <file>'`,
  where `<file>` is the suite's Egress test, which passes `--log-net-log` to its own launch only
  (S4). Step 1 confirms the command runs on Linux.
- **Connection.** With the pipe (decision D1, S1), the browser process opens no listening socket
  and writes no `DevToolsActivePort` file. The port fallback has no item here, because it does not
  meet S1.
- **Command log.** The client's log contains no `Runtime.enable`, `Log.enable`,
  `Performance.enable`, `Debugger.enable`, or cookie-reading command.
- **Isolation.** A cookie seeded into one Persona's browser profile is not sent from another's; the
  fixture checks cookie names and compares values in memory only. A seeded cookie appears in the
  first request to a cookie-echo fixture, and the WARC holds the marker in its place. A seeded
  cookie whose `hostOnly` is false is sent to a subdomain fixture, and a host-only one is not. An
  import for a Persona whose browser is running is refused with the reason. A Capture in a private
  window is refused.
- **Selector parity.** For a fixed set of patterns and pages, the launched-browser match agrees with
  `selectorMatchesText` on the stored Extracted Text.
- **Passive capture.** Stopping the Capture Session stops capture; an excluded URL produces no
  Capture and a `skipped` event; Selector mode captures only matching pages; no surface shows a
  `launched-passive` Capture as operator-witnessed.
- **Page-visible effects.** The first slice's probe facts (`navigator.webdriver`, `window.chrome`
  keys, the `Error.stack` getter count, resource timing), recorded per pairing with each domain the
  engine enables, including `Page` and the isolated-world reads.
- **Browser updates.** Each Capture records the browser version, and the suite records the versions
  it passed on.

## Alternatives rejected

- **Controls injected into the page.** A capture button or Selector highlights change the DOM that
  the MHTML records and are visible to the page.
- **The Companion inside the launched browser, in this stage.** It puts extension code back in the
  browser that acquires evidence, which ADR-0034 removes. CE-S3 decides what the Companion does.
- **Attaching to the Operator's own profile.** Chrome 136 and later refuse remote debugging on the
  default profile directory, and that profile mixes private browsing into the Capture Scope
  ADR-0037 draws.
- **Copying a browser profile from the Operator's everyday browser, or every cookie in it by
  default.** It would import the Operator's own identity. The importer refuses a `Cookies` database
  today, which Chrome encrypts to the operating system and, on Windows, to Chrome itself
  (`cookieFiles/index.ts:9-15`). Under the 2026-10-10 ruling, a browser import takes the cookies
  of the sites the Operator picks, takes a whole browser profile's cookies only when the Operator
  states that the source browser profile serves this Persona alone, and never reads a store that
  App-Bound Encryption protects (see [Cookie seeding](#cookie-seeding-from-the-persona-import)).
- **A launched browser that outlives its Capture Session.** Captures taken in it would have no
  recording, and the Capture Scope would have no end.
- **Fetching bodies only at the moment of Capture.** It keeps the bodies of uncaptured pages out of
  Birdbrain's memory and adds less main-process work, but Chrome's buffer then decides which bodies
  survive an hour of browsing, and the engine cannot choose. Fetching at `loadingFinished` follows
  the first slice; if P12 shows its cost is too high, this is the fallback, with every evicted body
  in the inventory. Durable messages (P12) may change how many bodies survive.
- **A library launcher's default arguments.** Puppeteer's defaults select the plain-text password
  store and a mock keychain and set the automation flag.
- **An Electron persona window** (`persona-window`, #1505). Rejected in ADR-0034: its fingerprint
  differs from Chrome, and it can never be Firefox (:113-115).
- **One WARC per Capture Session, sliced at export.** Rejected in ADR-0035 (:49-52).
- **A recording proxy between the browser and the network, and the `Fetch` domain:** as in the
  first slice.
- **`--host-resolver-rules`** to stop local name resolution, as Hunchly's Tor guide does
  (identity-masking research, line 181). With SOCKS5 the probe saw the proxy resolve names,
  and the switch is on Chrome's unsupported-flag list.
- **Hiding the automation flag** with `--disable-blink-features=AutomationControlled`,
  `Emulation.setAutomationOverride`, or a script that overrides `navigator.webdriver`. ADR-0032
  excludes fingerprint impersonation.
- **Copying cookies from the launched browser profile back to the partition automatically.** It
  moves cookie values between stores on every Capture Session, and ADR-0034 accepts drift instead
  (:147).

## Proposed PR split

A proposal for the stage-2 plan, which settles it. Every code step is evidence-affecting at the
blocking tier: it gets human review, never merges automatically, and adds each new acquisition
module as a blocking row in the evidence-affecting paths assessment. No code step starts before
CE-10 (#598) merges. Each code step verifies with `pnpm lint`, `pnpm typecheck`,
`BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`, `pnpm build`, and `pnpm preflight` at head, plus the
commands named below.

1. **Probe (docs only).** Answers the P questions below on Chrome, Edge, Brave, and Chromium, on
   each platform available, in the form of the
   [stage-1 probe](2026-10-02-capture-engine-probe-spike.md), with the script in the doc. Done when
   each P question has a measured answer or is marked not measurable on the machines available,
   except P7: the ruling on decision D1 needs the pipe measured on Windows and macOS before step 4
   starts. Verify with `.claude/hooks/vale-prose.sh --base origin/main`.
2. **Verifier release step.** `launched`, the browser identity fields, the stage-2 inventory
   reasons, and the passive rule field, per the rulings on decisions D5 and D12, unless CE-5 carries
   them. Each new value and field gets a refine that requires the next schema version, as
   `exhibitNumber` requires 3 and the Egress fields require 5 (`src/shared/schemas.ts:517-531`), and
   `fieldMinReaderSchemaVersion` stamps that version on an entry that carries one
   (`src/main/services/manifest.ts:774-781`), so an older verifier reports itself too old instead of
   reporting a broken chain. `MANIFEST_SCHEMA_VERSION` (`src/shared/constants.ts:81`) takes the next
   number after CE-5's, settled when the step starts against the releases that have shipped, as
   CE-5's is; whatever CE-5 carries shares CE-5's number instead. The roadmap's manifest schema lane
   gives stage 2 no slot: this step joins it after the release carrying CE-5's verifier, and #1498's
   Persona fields, re-triaged on 2026-10-10 without `persona-window`, keep their place beside CE-5
   under CE-5's number. Starts in `src/shared/schemas.ts`, `src/shared/types.ts`,
   `src/shared/constants.ts`, `src/main/services/manifest.ts`, `src/shared/verify/`, and
   `src/verifier/`. Done when entries written before the change still verify, an entry carrying each
   new value and field verifies in the shared and the standalone verifier, an entry with an unknown
   method or reason fails strict parse, and an entry carrying a new value under an older stamp fails
   its refine. Also verify with `pnpm build:verifier`. A tagged release ships it before step 4
   merges, and its release notes tell Shared Case members to upgrade together, as the roadmap's
   gates ask of the releases carrying #1747 and CE-5's verifier.
3. **Launcher, connection, browser profiles, and Egress, with no Capture.** After CE-3 merges, the
   probe, and the Capture Session panel's design from the UI brief (decisions D19 and D22).
   Carries out the rulings on decisions D1, D2, D8, D9, D10, D14, D16, and D23. Starts in a new
   module under `src/main/services/`, placed per `docs/agents/architecture.md`, and `settings.ts`
   after CE-4 in the hot-file order. Adds the launched-browser known-answer suite
   under `tests/main/services/`, in a directory named for that module (`<module>` below), run on
   Linux with `xvfb-run --auto-servernum pnpm test tests/main/services/<module>/` against the pinned
   Chrome for Testing build that decision D23's download script fetches and checks by hash; steps 4
   to 6 add their items to it. Done when a Capture Session launches and closes the browser; the
   connection, Egress, and command-log validation items pass in that suite; the engine denies
   geolocation, and warns of an extension target while the Egress is not Direct, per decisions D16
   and D14; ending a Capture Session deletes a throwaway browser profile; and the orphan sweep
   removes a browser profile whose Persona row is gone.
4. **Clicked `launched` Captures.** After CE-7, CE-8, CE-10, step 2's release, the ADR that the
   ruling on decision D3 needs, the feasibility pass on the Capture Session panel mock (decisions
   D19 and D22), and the pipe measured on Windows and macOS (P7, decision D1). Carries out the
   ruling on decision D6. Holds the `captureLifecycle.ts` hot file after CE-9 in the roadmap's
   order. Starts in the step-3 module, `captureLifecycle.ts` (`admit` and the launched route), and
   the WARC writer and inventory modules CE-7 and CE-8 add. Done when the first slice's known
   answers, attach before request, the cut, and the credentials items pass in the suite against a
   launched Chrome; a package exported from a `launched` Capture verifies; and a two-peer
   `MemoryTransport` test, as CE-7 and CE-8 have, shows that the receiver verifies a `launched`
   Capture's entry and that its Shared Case walk passes. Also verify with `pnpm test:e2e`.
5. **Persona browser profiles and seeding.** After #1498's release. Carries out the rulings on
   decisions D7, D11, D15, D17 (measure the Linux key store first), and D21. Starts in the step-3
   module, `src/main/services/persona/personaSessions.ts`, `src/main/services/persona/cookieFiles/`,
   `reportHtml.ts`, `certification.ts`, `verifyRunbook.ts`, and the Capture detail components under
   `src/renderer/components/captures/`. Done when the isolation items pass, deleting a Persona
   removes its browser profiles, and Capture detail, `report.html`, `certification.html`, and
   `VERIFY.md` show the confirmed wording. Takes the migration lane only if the plan adds per-store
   counts to the `personas` row. The browser import in
   [Cookie seeding](#cookie-seeding-from-the-persona-import) is not part of this step. A new ticket
   under #541 builds it, behind three gates: the maintainer approves the cookie-import ADR, the
   ticket is grilled with the maintainer before it is `ready-for-agent`, and the partition's
   at-rest wording is true (CE-AR).
6. **Passive capture (#600 with #599).** After step 4, the verifier release that the ruling on
   decision D5 sets, and the ADR-0037 amendment that the ruling on decision D13 needs. Starts
   in the step-3 module, `src/main/services/db/selectorRepo.ts`, `selectorLifecycle.ts`,
   `safeRegex.ts`, `exclusionPolicy.ts`, `src/shared/urlPatterns.ts`, `reportHtml.ts`,
   `certification.ts`, `verifyRunbook.ts`, and
   `src/renderer/components/captures/captureMethodLabel.ts`. The PR adds the module that takes
   `selectorMatchesText` out of `selectorRepo.ts` as a blocking row in the evidence-affecting paths
   assessment, worded as the #400 amendment is: it decides which Selectors a launched page matches
   and the Persisted Matches it feeds. Outside `src/main/services/db/**`, that module would
   otherwise match no entry (assessment, "Known gap: carve-outs are caught by review, not by a
   check"). Done when #600's and #599's acceptance criteria pass, with the Selector parity and
   passive capture items; a test shows that a timed-out exclusion pattern skips a passive page; a
   two-peer `MemoryTransport` test shows that the receiver verifies a `launched-passive` Capture's
   entry and that its Shared Case walk passes; and `CONTEXT.md` drops _Planned_ from the clauses it
   makes true.

The migration and Case Archive lanes are untouched unless the `captures` row mirrors the new fields
(the plan decides), because `launched` Captures carry the same files as the first slice.

## Decisions and rulings

These come from this spec. The maintainer ruled on all of them except D18 on 2026-10-10. Four
gates in the roadmap touch this stage, and the maintainer ruled on two of them the same day:
#598's direction is a utility process for extraction (CE-10), and #1505 is closed as superseded,
with `persona-window` out of #1498's scope. Two stay open: approving the first-slice spec and the
CE-P plan, including whether CE-5 carries `launched`, and tagging the release that carries CE-5's
verifier.

- **D1. Transport.** Ruled 2026-10-10: the pipe, with a port fallback built only if the pipe proves
  problematic ([The browser connection](#the-browser-connection) gives the fallback and what
  triggers it). S1 holds only with the pipe: with a fixed port, a second client using only the URL
  from `/json/version` was accepted. The ruling amends ADR-0034's "with a remote-debugging port" to
  "remote-debugging connection".
- **D2. CDP client.** Ruled 2026-10-10: a client in `src/main`, with no runtime dependency
  ([The CDP client](#the-cdp-client)). Using `devtools-protocol` for types is a separate
  development-dependency approval.
- **D3. Request bodies.** Ruled 2026-10-10: a launched-browser Transaction Record carries no
  request bodies ([Credentials and passwords](#credentials-and-passwords)). Before step 4, an ADR
  amends ADR-0035, ADR-0036, and the Transaction Record entry of `CONTEXT.md`, which says a secret
  in a body stays in the record.
- **D4. Where the CDP client runs.** Ruled 2026-10-10: in the main process. It moves to the
  utility process that CE-10 adds only if measurements show it stalls.
- **D5. `launched-passive` sequencing.** Ruled 2026-10-10: the verifier learns the value in a
  release before #600's writer merges, and the glossary and reporting surfaces change with #600.
  #599 needs a clarification to match; it says the value lands with #600 and "not before."
- **D6. HTTP cache.** Ruled 2026-10-10: disabled on recorded targets during a Capture Session, as
  #1499 does for the partition.
- **D7. Seeding.** Ruled 2026-10-10: one Persona import seeds both the Electron partition and the
  launched-browser profile. With this ruling the maintainer asked for installed browsers to be
  detected and their cookies imported; the same day's browser cookie import ruling makes that a
  second source for the one import
  ([Cookie seeding](#cookie-seeding-from-the-persona-import)).
- **D8. Browser profiles per product.** Ruled 2026-10-10: one browser profile per Persona per
  browser product.
- **D9. A Capture Session with no Persona.** Ruled 2026-10-10: a throwaway browser profile, removed
  when the Capture Session ends.
- **D10. Concurrent launched browsers.** Ruled 2026-10-10: one at a time in the first stage-2
  release.
- **D11. Persona wording.** Ruled 2026-10-10: the strings in [Persona wording](#persona-wording) as
  proposed; the `background` and legacy `extension` wording is unchanged.
- **D12. New signed fields.** Ruled 2026-10-10: the signed entry carries the browser product,
  version, and family; a `launched-passive` entry records which rule took it; the matching
  Selectors stay off the signed entry.
- **D13. Exclusion timeouts.** Ruled 2026-10-10: a timed-out exclusion pattern counts as a match
  for passive Captures only. Clicked Captures keep today's behavior, where a timeout admits the
  Capture (`exclusionPolicy.ts:34-41`). The ruling amends ADR-0037's "The Case's exclusion policy
  applies to passive Captures as it does to clicked ones" (:35-36) and the same constraint in
  #600, and `safeRegexTest` reports a timeout apart from no match
  ([Selector matching](#selector-matching-and-passive-capture)).
- **D14. Policy or extension proxy override.** Ruled 2026-10-10: the engine warns in the Capture
  Session panel when an extension target appears while the Egress is not Direct, and Birdbrain
  does not refuse Captures.
- **D15. Chrome's own features.** Ruled 2026-10-10: launched browser profiles disable Chrome sync
  and password saving; background networking stays on, because Chromium describes its switch as a
  testing aid.
- **D16. Geolocation.** Ruled 2026-10-10: denied for all origins in launched browsers.
- **D17. Linux key store.** Ruled 2026-10-10: on Linux, measure which key store the launched
  browser picks (P16) before adding any plaintext warning, because Electron's
  `safeStorage.getSelectedStorageBackend()` and Chrome's choice need not match.
- **D18. Glossary.** Still open. `CONTEXT.md` has no entry for Capture Scope, and its Active Case
  entry names the extension only. Add or amend both when #600 lands (recommended).
- **D19. The Capture Session panel.** Ruled 2026-10-10 with D22: an agent writes a UI brief for
  the panel and for telling the launched browser apart from the everyday one, and the Birdbrain UI
  design project designs both. The panel's design lands before step 3 builds the panel, and a
  feasibility pass on the mock comes before step 4.
- **D20. A launched browser runs only inside a Capture Session.** Ruled 2026-10-10: launching
  starts a Capture Session if none is running and joins the running one otherwise; ending the
  Capture Session closes the browser; closing the browser's last window closes the browser and
  leaves the Capture Session running
  ([Starting a Capture Session](#starting-a-capture-session-in-a-launched-browser)). This narrows
  two records, which both allow a `launched` Capture outside a running Capture Session: the
  Capture Method entry of `CONTEXT.md` gives `launched` "a Transaction Record when a Capture
  Session is running" (:78), and ADR-0034 scopes recording to a Capture Session in a launched
  browser (:69-71).
- **D21. The Persona of a launched browser.** Ruled 2026-10-10: the Operator chooses it when
  launching the browser, default none, and it holds for that browser's life. This extends the
  persona plan's decision 6, a per-job picker for Recapture and add-URL, to a job that takes many
  Captures, and the threat-model delta (#546) updates the wrong-persona mitigation: one choice
  stamps every Capture taken in that browser, where the plan's picker sets the stamp of one render
  (`docs/plans/2026-09-19-persona-cookie-import.md`, decision 6 and Phase 6).
- **D22. Telling the browsers apart.** Ruled 2026-10-10 with D19: the same UI brief covers how the
  Operator tells the launched browser from the everyday one at a glance, beyond the Capture
  Session panel. The launched Chrome has the same icon as the everyday Chrome (see
  [Risks](#risks)).
- **D23. A browser for the known-answer suite.** Ruled 2026-10-10: a small in-repo download script
  fetches a pinned Chrome for Testing build for CI and checks its hash, with no new dependency.
  A person reruns the suite by hand against Edge, Brave, and branded Chrome when they update. The
  suite needs a pinned version because a pass names the version it ran on (E7).
- **Schema 7.** Ruled 2026-10-31 for #1830: the Persona fields `personaId` and `personaLabel`
  raise the manifest schema number like any other added field (ADR-0030, amended), and they and
  the launched browser's values move `MANIFEST_SCHEMA_VERSION` from 6 to 7 in one change. Schema
  7 carries no seed-source field. The inventory drops "tab not visible" and "loaded
  speculatively". "Served by a service worker" is not an absence reason: the Transaction Record
  counts the exchanges a service worker served. The request bodies a launched browser withholds
  (ADR-0051) are a count on the signed entry, and no request id or URL enters the Manifest.
  #1830 no longer waits on the probe issue #1828.

## Open questions

The stage-2 probe answers the P questions before any code brief. Q1 is a product question and Q2
a design question; the plan or the maintainer settles each.

- **P1. PDF in a windowed browser.** `Page.printToPDF` returned data once in Chrome 150 on Linux.
  A 2020 report (puppeteer/puppeteer#6220) shows it answering "PrintToPDF is not implemented" and
  quotes Puppeteer's note of the time that PDF generation was "only supported in Chrome headless".
  Not measured on the other products or platforms.
- **P2. Screenshots.** Whether `captureBeyondViewport` in a visible window resizes or reflows the
  page in a way the page can observe, and whether a tab that is not in front can be captured.
- **P3. `Page` and isolated-world reads.** Whether `Page.enable`, `Page.frameNavigated`,
  `Page.createIsolatedWorld`, and `Runtime.evaluate` in an isolated world change anything the page
  records, rerunning the first slice's probe checks, including the `Error.stack` getter count. The
  checks cover the Scroll-to-load step and reset scripts too: they scroll the page by design, and
  the probe records what else they change.
- **P4. Popups, new tabs, and cross-site navigation.** Measured once for `window.open`. Whether a
  `target=_blank` link and a cross-site navigation keep the target and CDP session attached and
  the first request seen, and whether durable messages (P12) keep bodies across a cross-site
  navigation.
- **P5. Out-of-process iframes and workers.** Which target reports their requests.
- **P6. WebRTC.** Whether each product honors `--webrtc-ip-handling-policy` (Chrome 150 on Linux
  did), and whether `--force-webrtc-ip-handling-policy` is read only by `content_shell` and
  headless, which rests on a code search. If no switch holds for a product, that product cannot
  launch while the Egress is not Direct. Whether ICE gathering from an isolated world on the first
  tab's `about:blank` gives the probe's result on a loaded `http` page; if it does not, the check
  needs a page of its own, which the probe names.
- **P7. The pipe on each platform.** Windows and macOS support is read from
  `devtools_pipe_handler.cc`, not run; Snap- and Flatpak-packaged browsers are untried. The ruling
  on decision D1 needs Windows and macOS measured before step 4, and a problem there is one
  trigger for the port fallback.
- **P8. When the pipe closes.** Whether the browser exits when Birdbrain does, and what a "Relaunch
  to update" during a Capture Session does.
- **P9. Service workers.** Whether a response a service worker served stays in the record as the
  page saw it, and how the inventory counts the worker's own fetches.
- **P10. Back-forward cache and speculative loads.** Whether either leaves any network trace on the
  tab's target.
- **P11. Message order.** Whether the browser connection's message stream keeps order across a
  tab's CDP sessions; the cut depends on it.
- **P12. Body fetching cost.** Main-process cost of fetching every body at `loadingFinished` over an
  hour of browsing, against how often Chrome's buffer drops a body when fetched at Capture time,
  with and without durable messages. `Network.enable` takes `enableDurableMessages`
  (experimental), which keeps response bodies outside the renderer "so that these survive a
  cross-process navigation" and requires `maxTotalBufferSize`. The protocol says that parameter
  is being deprecated in favor of `Network.configureDurableMessages` (experimental), "due to the
  possibility of deadlocks when awaiting Network.enable before issuing
  Runtime.runIfWaitingForDebugger", which is the order
  [Attach before request](#attach-before-request) uses, so the probe measures the command too.
- **P13. Traffic around the proxy.** Whether all of the browser's own traffic (updates, Safe
  Browsing, sync) follows `--proxy-server`; QUIC, DNS prefetch, and preconnect under a proxy; and
  what CDP reports as the remote address through an HTTP proxy.
- **P14. Seeding mechanics.** Whether `--no-startup-window` starts the pipe handler without a
  window; whether `Browser.close` writes cookies set with `Storage.setCookies` to disk; whether a
  session cookie survives a launched browser restart; what a seeding launch does when a browser
  left from an earlier run still holds the browser profile (`process_singleton.h:39-42`).
- **P15. Preferences written before first launch.** Whether Chrome keeps a
  `credentials_enable_service` value written into a new browser profile.
- **P16. Cookies at rest.** Which key store each product selects for a non-default data directory on
  each platform, and whether it matches Electron's `safeStorage` backend. Under the ruling on
  decision D17, the Linux answer comes before any plaintext warning.
- **P17. The shortcut.** Whether Electron's `globalShortcut` works on each desktop the app supports,
  Linux Wayland sessions included.
- **P18. DevTools.** Whether the Operator opening DevTools in a tab affects the engine's CDP session
  on it; with `chrome.debugger`, DevTools detaches the extension (TLS spike, section 3.3).
- **P19. Banners.** Whether Chrome shows any banner or infobar in the engine's launch configuration;
  not observed under `xvfb-run`.
- **P20. Discovery.** Install locations per operating system for Edge, Brave, and Chromium, and for
  Snap and Flatpak installs; what `Browser.getVersion` reports as the product for Brave.
- **P21, P22.** Moved to decisions D22 and D23: neither is a measurement.
- **P23. Global `WebSocket` in the main process.** Checked only under `ELECTRON_RUN_AS_NODE`;
  matters only if the port fallback of decision D1 is built.
- **P24. MHTML equivalence.** Whether `Page.captureSnapshot` output matches what `wc.savePage`
  writes for the same page.
- **Q1. Single-page applications and repeats in passive mode.** Whether passive capture reacts to a
  same-document navigation, re-checks a feed that grows after load, or captures a URL it captured
  a minute ago, and whether the manual dedup window applies to the launched route.
- **Q2. Detecting a bot-challenge refusal.** How the engine tells that a site challenged or refused
  a launched browser. The ruling on decision D1 makes a count of those refusals one trigger for the
  port fallback ([The browser connection](#the-browser-connection)), and the count needs this
  method. The stage-2 plan assigns the step that builds the count.

## Not in this stage

The Companion pipe and the removal of the extension's capture code (CE-S3), Firefox and WebDriver
BiDi (stage 4), a per-Persona Egress (ADR-0032 rule 4, #541), a Capture triggered by an MCP client
(#548), the Content Hash of a Capture without MHTML, WebSocket frames in the record (first slice,
open question 5), downloads started in a launched browser, permission defaults beyond geolocation,
the in-app display of capture fields (#1816), a WACZ export (#799), and the browser cookie import
of [Cookie seeding](#cookie-seeding-from-the-persona-import), which a new ticket under #541 builds
after the maintainer approves the cookie-import ADR and the partition's at-rest wording is true.

## Review and approval

The implementation adds an acquisition path, changes the Manifest and the verifier (and the
database schema, if the `captures` row mirrors the new fields), and launches software that holds
the Operator's or a Persona's signed-in sessions. It is evidence-affecting at the blocking tier, so
it gets human review and does not merge automatically. New acquisition modules, and the
selector-matching module step 6 moves out of `selectorRepo.ts`, join the blocking tier of the
[evidence-affecting paths assessment](2026-07-31-evidence-affecting-paths-assessment.md). The plan
waits for approval, and the changes to `SECURITY.md` and the threat model ship with the
code that makes them true.

## Appendix: the probe

Throwaway; not part of the build. It ran once per configuration in the results table. The artifact
block and the `serverPort` field were added afterwards and ran in fixed-port and pipe mode.

```js
// Throwaway probe for the launched-browser design spec (CE-S2).
// Launches Google Chrome with a Birdbrain-style owned profile and measures:
// navigator.webdriver per transport, attach-before-request on a popup,
// WebRTC candidates per policy, and what CDP reports as the remote address
// of a response sent through a SOCKS5 proxy.
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MODE = process.argv[2] // port-fixed | port-zero | pipe
const WITH_PROXY = process.argv.includes('--proxy')
const WEBRTC_POLICY = process.argv.includes('--webrtc') ? 'disable_non_proxied_udp' : null
const OUT = process.env.PROBE_OUT || '/tmp/cs2-out'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const serverLog = []
const socksLog = []

const PAGE = `<!doctype html><title>probe</title><h1>probe</h1>
<script>
window.__facts = (async () => {
  const cands = []
  try {
    const pc = new RTCPeerConnection({ iceServers: [] })
    pc.createDataChannel('x')
    await new Promise(async (resolve) => {
      pc.onicecandidate = (e) => { if (e.candidate) cands.push(e.candidate.candidate); else resolve() }
      await pc.setLocalDescription(await pc.createOffer())
      setTimeout(resolve, 3000)
    })
  } catch (e) { cands.push('error:' + e) }
  return { webdriver: navigator.webdriver, chromeKeys: Object.keys(window.chrome || {}), cands }
})()
</script>`

const server = http.createServer((req, res) => {
  serverLog.push({ url: req.url, remote: req.socket.remoteAddress + ':' + req.socket.remotePort, ua: req.headers['user-agent'] })
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
  if (req.url === '/popup.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<title>popup</title><p>popup</p>')
  res.writeHead(404).end()
})

// Minimal SOCKS5, no auth, CONNECT only.
const socks = net.createServer((c) => {
  c.once('data', (greet) => {
    c.write(Buffer.from([5, 0]))
    c.once('data', (req) => {
      const atyp = req[3]
      let host, off
      if (atyp === 1) { host = [...req.subarray(4, 8)].join('.'); off = 8 }
      else if (atyp === 3) { const n = req[4]; host = req.subarray(5, 5 + n).toString(); off = 5 + n }
      else { c.end(); return }
      const port = req.readUInt16BE(off)
      socksLog.push({ host, port, atyp })
      const up = net.connect(port, host, () => {
        c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        c.pipe(up); up.pipe(c)
      })
      up.on('error', () => c.end())
    })
  })
  c.on('error', () => {})
})

class Cdp {
  constructor(send) { this.sendRaw = send; this.id = 0; this.pending = new Map(); this.handlers = [] }
  onMessage(text) {
    const m = JSON.parse(text)
    if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) }
    else for (const h of this.handlers) h(m)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    const msg = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    this.sendRaw(JSON.stringify(msg))
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); setTimeout(() => rej(new Error('timeout ' + method)), 15000) })
  }
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  await new Promise((r) => socks.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cs2-profile-'))
  const args = ['--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank']
  const FIXED_PORT = 9333
  if (MODE === 'port-fixed') args.unshift('--remote-debugging-port=' + FIXED_PORT)
  if (MODE === 'port-zero') args.unshift('--remote-debugging-port=0')
  if (MODE === 'pipe') args.unshift('--remote-debugging-pipe')
  if (WITH_PROXY) args.unshift('--proxy-server=socks5://127.0.0.1:' + socks.address().port, '--proxy-bypass-list=<-loopback>')
  if (WEBRTC_POLICY) args.unshift('--webrtc-ip-handling-policy=' + WEBRTC_POLICY)
  const child = spawn('/usr/bin/google-chrome', args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })
  let cdp
  let secondClient = null
  if (MODE === 'pipe') {
    const toChrome = child.stdio[3], fromChrome = child.stdio[4]
    cdp = new Cdp((t) => toChrome.write(t + '\0'))
    let buf = ''
    fromChrome.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\0')) >= 0) { const msg = buf.slice(0, i); buf = buf.slice(i + 1); cdp.onMessage(msg) } })
  } else {
    let port = FIXED_PORT
    if (MODE === 'port-zero') {
      for (let i = 0; i < 100; i++) { try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break } catch { await sleep(100) } }
    }
    let ver
    for (let i = 0; i < 100; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break } catch { await sleep(100) } }
    const ws = new WebSocket(ver.webSocketDebuggerUrl)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    cdp = new Cdp((t) => ws.send(t))
    ws.onmessage = (e) => cdp.onMessage(e.data)
    // A second, unrelated client: can it read the endpoint and drive the browser?
    const ws2 = new WebSocket(ver.webSocketDebuggerUrl)
    secondClient = await new Promise((r) => { ws2.onopen = () => { ws2.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })); }; ws2.onmessage = (e) => { r(JSON.parse(e.data).result?.product || 'no-product'); ws2.close() }; ws2.onerror = () => r('refused'); setTimeout(() => r('timeout'), 5000) })
  }
  const version = await cdp.send('Browser.getVersion')

  // Auto-attach to every page target, paused before it runs, so the engine can
  // enable Network on each new tab before its first request.
  const sessions = new Map() // sessionId -> { targetId, url, events: [] }
  const net = []
  cdp.handlers.push(async (m) => {
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo, waitingForDebugger } = m.params
      sessions.set(sessionId, { targetId: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url, waitingForDebugger })
      try {
        await cdp.send('Network.enable', {}, sessionId)
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId)
      } catch (e) { sessions.get(sessionId).enableError = String(e.message) }
      if (waitingForDebugger) await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    }
    if (m.method === 'Network.requestWillBeSent') net.push({ s: m.sessionId, ev: 'req', url: m.params.request.url })
    if (m.method === 'Network.responseReceived') net.push({ s: m.sessionId, ev: 'resp', url: m.params.response.url, remoteIPAddress: m.params.response.remoteIPAddress, remotePort: m.params.response.remotePort, hasSecurity: !!m.params.response.securityDetails })
  })
  await cdp.send('Target.setDiscoverTargets', { discover: true })
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
  // Existing page targets (the initial about:blank) are attached explicitly.
  const { targetInfos } = await cdp.send('Target.getTargets')
  for (const t of targetInfos.filter((t) => t.type === 'page')) await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  await sleep(500)
  const mainSession = [...sessions.entries()].find(([, v]) => v.type === 'page')?.[0]
  await cdp.send('Page.navigate', { url: base + '/' }, mainSession)
  await sleep(1500)
  const facts = await cdp.send('Runtime.evaluate', { expression: 'window.__facts', awaitPromise: true, returnByValue: true }, mainSession)
  // Open a popup from the page with a user gesture; the new target must be
  // attached and paused before its document request.
  await cdp.send('Runtime.evaluate', { expression: `window.open('${base}/popup.html')`, userGesture: true }, mainSession)
  await sleep(2000)
  const artifacts = {}
  for (const [name, method, params] of [
    ['mhtml', 'Page.captureSnapshot', { format: 'mhtml' }],
    ['screenshot', 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }],
    ['pdf', 'Page.printToPDF', {}]
  ]) {
    try {
      const r = await cdp.send(method, params, mainSession)
      const data = r.data
      artifacts[name] = { ok: true, length: data.length, head: name === 'mhtml' ? data.slice(0, 40) : Buffer.from(data, 'base64').subarray(0, 5).toString('latin1') }
    } catch (e) { artifacts[name] = { ok: false, error: String(e.message).slice(0, 200) } }
  }
  const out = { artifacts,
    mode: MODE, withProxy: WITH_PROXY, webrtcPolicy: WEBRTC_POLICY,
    version: { product: version.product, userAgent: version.userAgent },
    secondClient,
    pageFacts: facts.result.value,
    sessions: [...sessions.values()],
    net: net.map((n) => ({ ...n, url: n.url.replace(base, '<base>') , s: n.s ? [...sessions.keys()].indexOf(n.s) : 'browser' })),
    serverLog: serverLog.map((l) => ({ ...l })),
    socksLog,
    proxyPort: socks.address().port,
    serverPort: server.address().port,
    stderrTail: stderr.split('\n').slice(-5)
  }
  fs.writeFileSync(path.join(OUT, `result-${MODE}${WITH_PROXY ? '-proxy' : ''}${WEBRTC_POLICY ? '-webrtc' : ''}.json`), JSON.stringify(out, null, 2))
  await cdp.send('Browser.close').catch(() => {})
  await sleep(500)
  child.kill()
  process.exit(0)
}
setTimeout(() => { console.error('probe timeout'); process.exit(2) }, 60000)
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
```

```shell
for mode in port-fixed pipe port-zero; do
  ELECTRON_RUN_AS_NODE=1 xvfb-run --auto-servernum node_modules/.bin/electron probe.mjs $mode
done
ELECTRON_RUN_AS_NODE=1 xvfb-run --auto-servernum node_modules/.bin/electron probe.mjs port-fixed --proxy
ELECTRON_RUN_AS_NODE=1 xvfb-run --auto-servernum node_modules/.bin/electron probe.mjs port-fixed --proxy --webrtc
```
