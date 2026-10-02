# The app acquires over the browser's remote protocol, and the extension is a Companion

**Status:** Accepted

**Date:** 2026-09-30

Amends [ADR-0002](0002-tls-capture-corroboration-only.md) (binding is no longer deferred where
the engine attaches before the request) and
[ADR-0030](0030-persona-is-a-provenance-axis-beside-operator.md) (the `persona-window` method and
the single Electron session per Persona). Grilled and confirmed by the maintainer on 2026-09-29
and 2026-09-30. Nothing in this record is implemented. The first slice is designed in
[the capture engine spec](../specs/2026-09-30-capture-engine-design.md).

## Context

The Chrome extension acquires every operator-witnessed Capture today. `extension/src/background.ts`
calls `chrome.pageCapture.saveAsMHTML`, stitches a screenshot from `chrome.tabs.captureVisibleTab`
slices, and reads response headers from `chrome.webRequest`. Three problems follow:

- Evidence depends on extension APIs that change with each manifest revision.
- Firefox is out of reach. Firefox implements neither `pageCapture`
  ([Bugzilla 1745596](https://bugzilla.mozilla.org/show_bug.cgi?id=1745596)) nor the extension
  `debugger` API
  ([Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities)).
- The extension cannot produce a transaction-level record, which
  [the standards register](../agents/osint-investigation-standards.md) asks for
  beside MHTML.

The background renderer (`src/main/services/backgroundRenderer.ts`) already acquires from the
main process over the Chrome Devtools Protocol (CDP): it saves MHTML and takes one screenshot of
the whole document with no stitching.

One browser fact constrains every option. A browser hands over response bodies, and the TLS
details of a response, only to a collector that was in place before the request was sent. `Network.enable` in CDP,
`network.addDataCollector` in WebDriver BiDi, and `webRequest.filterResponseData` in a Firefox
extension all share that rule; the
[TLS spike](../specs/2026-05-17-chrome-debugger-tls-spike.md) measured the CDP case. A page the
Operator is already looking at cannot yield a Transaction Record without a reload, and a reload
is a second observation.

## Decision

**The app's capture engine is the only acquirer.** It runs in the main process and drives a
browser over that browser's remote protocol. No extension code decides which bytes become
evidence.

**The extension becomes the Companion.** It carries the Active Case, Tags, Selectors, and
highlights into the Operator's everyday browser, and it opens a pipe for the engine. Those
features use extension APIs that Firefox also implements, so the Companion can be ported. A
Firefox Companion carries those features only: Firefox has no extension `debugger` API, so it
opens no pipe and offers no `companion` Capture. Capturing in Firefox means a launched Firefox.

**Full-artifact witnessed Captures happen in a browser Birdbrain launched** (method `launched`).
Birdbrain starts Chrome, Edge, Brave, Chromium, or Firefox with a remote-debugging port and a
profile directory of its own, one per Persona. Chromium browsers are driven over CDP. Firefox is
driven over WebDriver BiDi, because Firefox removed CDP in version 141
([CDP retirement](https://fxdx.dev/cdp-retirement-in-firefox/)). Chrome 136 and later ignore the
remote-debugging switches on the default profile directory
([Chrome for Developers, 2025-03-17](https://developer.chrome.com/blog/remote-debugging-port)),
so a Birdbrain-owned profile is the only arrangement that works on current Chrome.

**Ad-hoc Captures in an everyday Chromium browser go through the Companion's pipe** (method
`companion`).
On request the Companion attaches `chrome.debugger` to the tab, the engine takes MHTML, one
screenshot of the whole document, and a PDF, and the Companion detaches. A `companion` Capture
never carries a Transaction Record or Bound TLS Details, because the page loaded before the
attach.

**Recording is scoped to a Capture Session in a launched browser.** There the engine attaches at
launch, before any request, so every Capture taken during the session carries a Transaction
Record. A session-long attach in the everyday browser is not built: the TLS spike estimated 70 to
85 percent coverage in a multi-origin session, and the record most likely to be missing is the
main document.

**Background Captures stay in Electron's hidden window.** A Persona may therefore hold one
browser session per engine, an Electron partition and a launched-browser profile, both seeded
from the same cookie import.

**Capture Methods** are `companion`, `launched`, `background`, and `duplicate`. `extension` stays
as a legacy value for rows already written. `persona-window`, which never shipped, is withdrawn.

**Order of work.** The engine gains its new artifacts in the background renderer first, then
launched Chromium browsers, then the Companion pipe and the removal of the extension's
acquisition code, then Firefox.

## What this amends

**ADR-0002.** Bound TLS Details are recorded on `launched` Captures in a Chromium browser and on
`background` Captures, where the engine is attached before the request. The corroboration
re-fetch stays the floor wherever it runs, and the Manifest Entry says which of the two it
holds. ADR-0032 still skips the re-fetch while the Egress is not Direct, and nothing here
restores a direct connection.
ADR-0002's warning stands for the case it was written about: a session-long `chrome.debugger`
attach in the everyday browser is still not built. The per-Capture attach the Companion makes
shows Chrome's debugging infobar for the length of one Capture, and the maintainer accepted
that. [ADR-0032](0032-route-app-egress-but-do-not-disguise-the-browser.md) skips the TLS Cert
Chain while the Egress is not Direct and left "recording the certificate the render itself
received" as a separate decision; this is that decision.

**ADR-0030.** A witnessed Capture under a Persona is a `launched` Capture in that Persona's
profile, not an Electron window. "One persistent Electron session" becomes one session per
engine. Persona stays an axis beside the method, and the label rules are unchanged.

## Considered options

- **Keep the extension as one acquirer among several.** Rejected: two evidence pipelines to
  validate under [ADR-0004](0004-adopt-osint-assurance-baseline.md), and the manifest dependency
  stays on the evidence path.
- **A Firefox extension using `webRequest.filterResponseData`.** It reads response bodies in the
  Operator's everyday Firefox, which no Chrome extension API can. Rejected for now: it puts a
  second browser's extension APIs on the evidence path. It remains the known route if recording
  without a launched window is wanted in Firefox.
- **An Electron-hosted persona window for witnessed Captures.** Rejected: the
  [persona spike](../specs/2026-09-19-persona-bot-detection-spike.md) measured a fingerprint that
  differs from Chrome, and it can never be Firefox.
- **Moving background renders to a launched headless browser.** Rejected: Birdbrain would need a
  browser on the machine or would have to bundle one, and a headless instance cannot share a
  profile with a running windowed one.

## Consequences

- "Capture what I am looking at" with a Transaction Record works only in a browser Birdbrain
  launched. The everyday browser gets the snapshot tier.
- The Companion requests the `debugger` permission. Chrome shows an infobar during each
  `companion` Capture, the install warning is stronger, and the Chrome Web Store review process
  says "dangerous permission requests" draw closer review
  ([review process](https://developer.chrome.com/docs/webstore/review-process)).
- An Operator whose everyday browser is Firefox has no ad-hoc Capture. A Firefox extension
  could take a whole-page screenshot itself, but that would put extension code back on the
  evidence path, so it is left as a later decision.
- A Transaction Record of a signed-in page would hold the `Cookie`, `Authorization`, and
  `Set-Cookie` values the browser reported.
  [ADR-0030](0030-persona-is-a-provenance-axis-beside-operator.md) keeps cookie values inside
  the browser session. How the record treats them is undecided and blocks the first slice; it
  is the first open question in the spec.
- Firefox Captures have no MHTML and no Bound TLS Details: BiDi offers neither. Response bodies
  need Firefox 143 or later, and responses served from the memory cache are not collectable
  ([Bugzilla 1971780](https://bugzilla.mozilla.org/show_bug.cgi?id=1971780),
  [Bugzilla 1992210](https://bugzilla.mozilla.org/show_bug.cgi?id=1992210)).
- A launched Firefox shows a robot icon in the address bar
  ([Bugzilla 1709035](https://bugzilla.mozilla.org/show_bug.cgi?id=1709035)), and the WebDriver
  specification has a BiDi session report itself to the page through `navigator.webdriver`. A
  site can tell. Whether a launched Chromium browser shows the same to a page is not measured.
- A launched browser has to follow the Egress of ADR-0032 and fail closed. The everyday browser
  is outside Birdbrain's Egress, as extension Captures are today.
- Each pairing of engine and browser is a separate method to validate under ADR-0004.
- A Persona's two sessions can drift apart, for example when a site signs one of them out.
- Open issue #635, which proposed the single-shot screenshot through `chrome.debugger` with the
  stitcher kept as a fallback, is answered by this record: the stitcher goes.
