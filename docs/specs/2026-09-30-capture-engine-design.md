# Capture engine, first slice: new artifacts in the background renderer

**Date:** 2026-09-30

**Status:** Design, awaiting approval. Nothing here is implemented.

**Decisions this rests on:**
[ADR-0034](../adr/0034-the-app-acquires-and-the-extension-is-a-companion.md) (the app acquires,
the extension is a Companion) and
[ADR-0035](../adr/0035-one-transaction-record-per-capture.md) (one Transaction Record per
Capture).

**Audience:** whoever implements this slice and whoever reviews it.

## Problem

ADR-0034 orders the work so that the capture engine gains its new artifacts in the path that
already exists before any new way of attaching to a browser depends on them. This slice adds
four things to a `background` Capture: a Transaction Record, an artifact inventory with a
recorded Scroll-to-load, Bound TLS Details, and a PDF. It adds no new Capture Method and changes
nothing in the extension.

## What exists today

All of this is in `src/main/services/backgroundRenderer.ts` unless another path is named.

- `renderPageInHiddenWindow` attaches `wc.debugger` for the whole render and enables no CDP
  event domain. A comment says so, and the network-idle tracker uses the session's `webRequest`
  API instead.
- The order is: load, wait for idle, `scrollToLoadLazyContent`, wait for idle, settle,
  screenshot, `wc.savePage(tmpPath, 'MHTML')`, extracted text.
- `captureFullPageScreenshot` takes one `Page.captureScreenshot` with `captureBeyondViewport`.
  It scales down to fit 16,384 pixels on a side and truncates at 32 megapixels. Nothing records
  that a screenshot was scaled or truncated.
- The image then passes through `trimTrailingBackground`, which removes trailing rows of uniform
  background color. Nothing records that either.
- Nothing records whether the scroll phase ran or how it ended.
- `RenderedPage` (`src/main/services/recapture.ts`) carries the MHTML stream, the screenshot, the
  text, the title, the final URL, the HTTP status, the user agent, the browser version, and
  Consent Suppression.
- The signed `capture` entry (`src/main/services/manifest.ts`) adds each newer fact as an
  optional field that is omitted when absent, so older entries keep their chain hashes.
- Manifest Entry schemas are `.strict()` (`src/shared/schemas.ts`). A verifier that does not
  know a field rejects the entry that carries it.
- The main process already calls `printToPDF` for reports (`src/main/services/pdfExport.ts`).

## Design

### Transaction Record

Enable the CDP `Network` domain before `wc.loadURL`, with the buffer limits `Network.enable`
accepts (`maxTotalBufferSize`, `maxResourceBufferSize`) set from a Birdbrain size budget. For
each exchange, keep what `Network.requestWillBeSent`, `Network.requestWillBeSentExtraInfo`,
`Network.responseReceived`, and `Network.responseReceivedExtraInfo` report, and fetch the body
with `Network.getResponseBody` after `Network.loadingFinished`.

Stop collecting at the moment the screenshot and MHTML are taken. Write one WARC (ISO
28500:2017) beside the MHTML, named for the capture id like the other artifacts:

- one `warcinfo` record naming Birdbrain's version, the browser version, the user agent, and
  the capture id;
- one `request` record and one `response` record for each exchange, each with a payload digest;
- a `response` record with headers and no body for each redirect, because the browser keeps no
  body for one.

The inventory, not the WARC, accounts for everything that has no complete exchange: a response
served from the browser cache, a request the consent filter cancelled, a request that failed, a
request still in flight when collection stopped, and a body that was over budget or that the
browser no longer held.

**What the record is and is not.** The browser hands over bodies after it has removed the
content encoding, and it reports headers as it parsed them. `headersText` is optional and is
absent for HTTP/2 and HTTP/3. A Transaction Record is the browser's account of the exchange.
It is not a packet capture, and the docs and the verifier never call it one.

### Artifact inventory and Scroll-to-load

The `capture` entry gains an inventory. For each of MHTML, Transaction Record, screenshot, and
PDF it says present or absent, and gives a reason when absent. For the screenshot it also says
whether the image was scaled down, truncated at the pixel caps, or trimmed of trailing
background rows, with its dimensions before and after. For the Transaction Record it
gives the counts described in the previous section.

The entry also records Scroll-to-load: whether it was requested, whether it ran, how it ended
(the page stopped growing, the height cap, the time budget, or a failure), and the document
height at the end. `scrollToLoadLazyContent` returns that outcome instead of nothing.

### Bound TLS Details

With the `Network` domain enabled before navigation, `Network.responseReceived` for the main
document carries `securityDetails`. Record the structured fields the TLS spike lists (protocol,
key exchange, cipher, subject, subject alternative names, issuer, validity, and the signed
certificate timestamps). They are a summary the browser produced, not the certificate bytes, so
they do not support independent signature checking.

Record them as a new optional field beside the existing `tls` field, never inside it. The
corroboration re-fetch is unchanged: it runs as it does today, and it is skipped while the
Egress is not Direct
([ADR-0032](../adr/0032-route-app-egress-but-do-not-disguise-the-browser.md)). When the main document came from the cache, the field is
absent and the inventory says why.

### PDF

Take a PDF of the page with `printToPDF` after the screenshot, the MHTML, and the end of
collection, because printing applies print styles and can start requests. Those requests are
outside the Transaction Record, and the inventory says the PDF was taken after collection
stopped.

### Manifest, schema, and verifier

- Every new field on the `capture` entry is optional and omitted when absent, so existing
  entries keep their chain hashes.
- Because the schemas are strict, the verifier learns the new fields in a release before any
  build writes them. This is the sequencing
  [ADR-0023](../adr/0023-exhibits-are-the-unit-of-evidence.md) set.
- The verifier treats the new hashes the way it treats `screenshotHash`
  (`src/shared/verify/evidencePackage.ts`): an absent hash claims nothing, and a present hash
  with a missing or different file fails.
- The `captures` row mirrors the new facts, which needs a schema migration.
- Export, Case Archive export and import, Duplicate, and deletion each handle a Capture's files
  by name today. Each has to carry, copy, or remove the two new files.

## Risk: enabling an event domain

The renderer enables no CDP event domain on purpose. The
[persona spike](2026-09-19-persona-bot-detection-spike.md) names one page-visible effect of an
attached debugger, tied to the `Runtime` domain, and did not test with the debugger attached.
This slice enables `Network`. Before it ships, run the spike's probe page with the domain off
and on, and record whether anything the page can observe changes.

## Validation

[ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md) requires known-answer validation for
an evidence-affecting method. Against a local fixture server that serves known bytes:

- each payload digest in the WARC equals the digest of the fixture's decoded payload, both when
  the server sends it uncompressed and when it sends it with `gzip`, because the stored body is
  the decoded one;
- a redirect chain, a cached response, a failed request, a cancelled request, and an over-budget
  body each appear where this design says they appear;
- a reader that is not the writer parses the file;
- a changed byte in the WARC or the PDF makes verification fail;
- entries written before this slice still verify;
- the Bound TLS Details for a fixture served over TLS match that fixture's certificate.

## Alternatives rejected

- **Intercepting every request with the CDP `Fetch` domain.** It holds each response until the
  engine has read the body, so no body is missed, but it pauses every request and changes page
  timing. Keep it as the fallback if validation shows `Network.getResponseBody` misses bodies
  often.
- **A recording proxy between the browser and the network.** It reads bytes off the wire, but it
  terminates TLS, which destroys the TLS observation, and it competes with the Egress of
  [ADR-0032](../adr/0032-route-app-egress-but-do-not-disguise-the-browser.md).
- **The session's `webRequest` API.** It reports headers and no bodies.
- **One WARC per Capture Session.** Rejected in ADR-0035.

## Open questions

1. **Credentials in the record.** `Network.requestWillBeSentExtraInfo` reports `Cookie` and
   `Authorization` request headers, and `Network.responseReceivedExtraInfo` reports `Set-Cookie`.
   Written into a WARC and copied through exports, those values are reusable account secrets
   outside the browser session.
   [ADR-0030](../adr/0030-persona-is-a-provenance-axis-beside-operator.md) says the only copy of
   a cookie value is the browser's own store. Today's header capture does not meet this problem:
   the extension listens without the `extraHeaders` option, and Chrome withholds `Cookie` and
   `Set-Cookie` from such a listener
   ([Chrome's `webRequest` reference](https://developer.chrome.com/docs/extensions/reference/api/webRequest)).
   Decide before any implementation whether the record replaces those header values with a
   marker and names the affected headers in the inventory, or whether ADR-0030 is amended.
   Tokens inside a response body or a URL are out of reach of any header rule, as they are in
   MHTML today.
2. **A new dependency.** `warcio` (the `webrecorder/warcio.js` repository) writes and reads WARC. The npm registry lists
   it as Apache-2.0 while the `LICENSE` file in the package is the MIT text; both are permissive,
   and the mismatch should be resolved before adoption. The alternative is a writer in this
   repository, validated against an outside reader. Adding the dependency needs the maintainer's
   approval.
3. **Decoded bodies under original headers.** The stored body is decoded while the recorded
   headers still name the original encoding and length. Browser-based archiving tools face the
   same mismatch. Find out what they write, and follow it if it is documented.
4. **Compression.** Whether the file is stored with each record compressed separately
   (`.warc.gz`) or uncompressed. The hash covers the stored bytes either way.
5. **Size budget.** The total and per-resource limits, and whether the 200 MB MHTML limit in
   `src/shared/constants.ts` is the right starting point.
6. **Cached responses.** Whether a fresh session partition per render, which the renderer already
   uses, makes cache hits rare enough to leave them to the inventory.
7. **PDF in a hidden window.** Whether `printToPDF` produces the page as rendered in the
   offscreen window, and whether it changes page state in a way that matters for a later step.
8. **WebSocket traffic.** Out of this slice. Decide later whether frames belong in the record.

## Not in this slice

Launched browsers, the Companion pipe, Firefox, the Content Hash of a Capture that has no MHTML,
and a WACZ export (#799).

## Review and approval

The implementation changes acquisition, the Manifest, the verifier, and the database schema. It
is evidence-affecting at the blocking tier, so it gets human review and does not merge
automatically, and its plan waits for approval.
