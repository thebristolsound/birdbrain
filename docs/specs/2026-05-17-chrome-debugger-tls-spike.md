# Chrome Debugger TLS Capture Feasibility Spike

**Spike ID:** docs/court-admissibility-114-tls-spike  
**Date:** 2026-05-17  
**Status:** Complete — recommendation only; human ratification required  
**Gates:** G5 TLS slice (#123)  
**Related:** Issue #114 (HITL spike), Issue #123 (G5 TLS implementation)

---

## Verdict

**Binding-capable** — with materially significant caveats that constrain when it delivers on the promise.

**Confidence:** Medium-high on the technical findings; medium on whether the UX cost is acceptable for Birdbrain's target users.

**Recommended #123 scope:** Ship corroboration-only (Node TLS re-fetch) as the primary implementation, with a documented design hook for a session-long binding mode as a documented follow-up. Rationale: the binding mode requires a session-long debugger attach that shows a browser-wide infobar for the entire recording session. That UX cost may be acceptable for a forensic tool, but it is a product decision, not a technical one, and it should be ratified explicitly before building.

---

## 1. What "binding" means here

**Binding origin proof:** the TLS certificate chain recorded is the chain Chrome observed on the specific HTTP response that produced the captured content. The cert is correlated 1:1 with the network transaction at capture time. The capture has no re-fetch gap.

**Corroboration-only:** a separate TLS connection is made from the Birdbrain main process (Node `tls`/`https`) after the capture is stored. It records whatever cert the origin was serving at re-fetch time, which is typically seconds to minutes after capture. The cert is not correlated with the specific captured transaction.

---

## 2. CDP mechanism for binding capture

### 2.1 The relevant CDP fields

`Network.responseReceived` carries a `response` object of type `Network.Response`. When the extension has attached a debugger and enabled the Network domain before the request is sent, the response object includes:

```
securityDetails: {
  protocol: string           // e.g. "TLS 1.3"
  keyExchange: string
  keyExchangeGroup?: string  // e.g. "X25519"
  cipher: string             // e.g. "AES_128_GCM"
  certificateId: CertificateId
  subjectName: string
  sanList: string[]          // DNS names and IP addresses in the SAN extension
  issuer: string             // CA display name
  validFrom: TimeSinceEpoch  // Unix epoch seconds
  validTo: TimeSinceEpoch
  signedCertificateTimestampList: SignedCertificateTimestamp[]
  certificateTransparencyCompliance: "unknown"|"not-compliant"|"compliant"
  serverSignatureAlgorithm?: integer
  encryptedClientHello: boolean
}
```

Source: [CDP Network domain reference](https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-SecurityDetails); [Scrapfly CDP reference](https://scrapfly.io/docs/cloud-browser-api/cdp-reference/Network); cross-confirmed by Puppeteer's `HTTPResponse.ts` implementation.

Notably, `securityDetails` is **not** the full DER-encoded certificate chain (no raw bytes). It is a structured summary. The `sanList`, `issuer`, `validFrom/To`, SCT list, and CT compliance status are present. This is sufficient to prove which certificate was served, by whom, and whether it was CT-logged — it is not sufficient to do independent signature verification without the raw bytes.

`Network.getCertificate` (experimental) returns DER-encoded cert bytes but only for the final response URL, not for redirects, and it is marked experimental in CDP.

### 2.2 The critical timing constraint: must attach before requestWillBeSent

Per empirical findings from production CDP users: if the debugger is not attached and `Network.enable` has not been sent **before** the `Network.requestWillBeSent` event fires for a given request, Chrome will not populate `securityDetails` on the corresponding `responseReceived` event for that request. Attempting `Network.getResponseBody` after the fact also fails with "No resource with given identifier found."

Source: [Stack Overflow — chrome debugger Network.getResponseBody no resource found](https://stackoverflow.com/questions/77643816/chrome-debugger-network-getresponsebody-gives-no-resource-with-given-identifier); confirmed by Puppeteer's design (it attaches at page creation, not at response time).

**Consequence for Birdbrain:** Birdbrain currently captures manually (user clicks toolbar after the page has finished loading) or automatically (on navigation complete). In both cases, the main-document `requestWillBeSent` has already fired by the time the user initiates a capture. A per-capture attach pattern — attach on capture click, read securityDetails, detach — **cannot** retrieve `securityDetails` for the already-completed main document request. Binding is only achievable via a session-long attach (debugger stays attached across the whole recording session, not just during one capture).

### 2.3 Cached-response gap

Chrome's own DevTools Security panel notes: "This response was loaded from cache. Some security details might be missing." When `response.fromDiskCache` or `response.fromMemoryCache` is true, `securityDetails` may be null or incomplete because no new TLS handshake occurred.

Source: [Chrome DevTools Security panel source](https://cdn.jsdelivr.net/npm/chrome-devtools-frontend@1.0.898466/front_end/panels/security/SecurityPanel.ts)

For forensic capture of pages that Chrome has cached (common for sites the investigator has visited before), `securityDetails` will be absent on the `responseReceived` event even with a perfectly functioning session-long attach. A fallback to the Node re-fetch would be required in this case regardless.

---

## 3. MV3 service worker lifecycle analysis

### 3.1 Baseline SW termination rules

Chrome terminates an MV3 extension service worker when any of:
- 30 seconds have elapsed since the last event handler invocation or API call.
- A single request/event handler runs longer than 5 minutes.
- A `fetch()` response takes more than 30 seconds.

Source: [Chrome Extension SW Lifecycle — developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

### 3.2 Chrome 118: debugger sessions keep the SW alive

Chrome 118 (released 2023-10) added a strong keepalive: **active debugger sessions created using the `chrome.debugger` API now keep the extension service worker alive**. This prevents SW termination during calls for this API.

Source: [Chrome SW Lifecycle — Chrome 118 section](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#chrome-118); [Known issues / closing the platform gap — item 3](https://developer.chrome.com/docs/extensions/develop/migrate/known-issues)

This is the most important positive finding. Before Chrome 118, a session-long debugger attach would be broken by SW termination after 30 seconds of inactivity (for example, between captures). Chrome 118+ removes that failure mode for as long as the debugger session remains attached.

**Floor version implication:** a session-long binding mode should declare `"minimum_chrome_version": "118"` in the manifest. Birdbrain already requires Chrome for extension features; adding this floor is low cost.

### 3.3 Remaining fragility: session boundary events

Even with Chrome 118 keepalives, the debugger session can still be terminated by Chrome at session boundaries:

- **Cross-origin navigation:** Chrome auto-detaches on `target_closed` (emitted when the tab navigates to a different origin). The extension receives `chrome.debugger.onDetach` with reason `target_closed`. The session's Network domain must be re-enabled after re-attach — and if the extension is slow to re-attach, the `requestWillBeSent` for the new page's main document may have already fired, breaking `securityDetails` for that capture.
- **User dismissal:** The user can click the cancel/dismiss button on the infobar, which force-detaches all debugger sessions from that extension across all tabs. `onDetach` fires with reason `canceled_by_user`. At this point the session must be re-established; the binding mode should surface this as an explicit user-visible warning ("TLS binding paused — click to re-enable").
- **DevTools open:** Chrome emits `onDetach` with reason `replaced_with_devtools` when the user opens Chrome DevTools for the attached tab. The extension is auto-detached.
- **Tab close:** `onDetach` fires with reason `target_closed`. Expected; no recovery needed.

Production evidence that these are real failure modes (not theoretical): the openclaw/openclaw#15099 issue thread, the scout-mcp extension documentation, and the openclaw/openclaw#15817 PR all describe and fix exactly these failure modes in MV3 extensions using `chrome.debugger` for long-running sessions.

Sources: [openclaw issue #15099](https://github.com/openclaw/openclaw/issues/15099); [openclaw PR #15817](https://github.com/openclaw/openclaw/pull/15817); [scout-mcp chrome-extension.md](https://github.com/stemado/scout-mcp/blob/main/docs/chrome-extension.md)

### 3.4 Reliability estimate

For a well-implemented session-long attach (Chrome 118+, re-attach on `target_closed`, `chrome.storage.session` for state persistence across SW restarts):

- **Same-origin browsing session** (user stays on one origin without navigating away): near-100% `securityDetails` availability.
- **Cross-origin navigation during session**: capture after navigation has a window where re-attach may miss `requestWillBeSent`. Estimated miss rate with a fast re-attach (< 200 ms): low, but non-zero and unverified without a hands-on prototype.
- **Cached responses** (browser disk/memory cache): `securityDetails` absent regardless of attach state. Rough frequency: high for repeat visits to commonly accessed sites.
- **User dismisses infobar**: session lost until user re-enables. Frequency: unknown; depends on user trust and familiarity with the infobar.

Overall `securityDetails` availability in realistic multi-origin investigation sessions: estimated 70–85% of captures. The remaining gap (cached responses + navigation races + infobar dismissal) always falls back to the corroboration path.

---

## 4. The infobar: UX and integrity implications

### 4.1 Behavior

When `chrome.debugger.attach()` is called, Chrome immediately renders an infobar notification in **all open Chrome windows** (not just the window containing the attached tab). The infobar text is:

> "[Extension Name] started debugging this browser"

A "Cancel" button allows the user to force-detach the extension from all its debugger sessions. The infobar persists until all sessions are detached. After detach, the infobar remains visible for approximately 5 seconds before auto-closing (per crbug.com/1096262, though the exact timeout may vary by Chrome version).

Sources: [Chromium infobar message string](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/app/resources.grd) (IDS_DEV_TOOLS_INFOBAR_LABEL comment: "The label does not disappear until the user dismisses it, even if the debugger is detached, and so should not imply that the debugger must still be debugging the browser, only that it was, and could still be."); [Stack Overflow — Clear infobar after debug mode](https://stackoverflow.com/questions/63441002/chrome-extension-clear-infobar-label-after-debug-mode); [Stack Overflow — Infobar shows on all Chrome windows](https://stackoverflow.com/questions/78420135/infobar-shows-all-chrome-windows-debugger-attach)

### 4.2 Mitigations available (and their limits)

| Mitigation | Feasibility | Assessment |
|---|---|---|
| `--silent-debugger-extension-api` Chrome flag | Requires user to launch Chrome with a custom flag | Non-starter for general-purpose Birdbrain installs. Acceptable only for dedicated investigation machines. |
| Per-capture (ephemeral) attach/detach | Avoids persistent infobar, but misses the `requestWillBeSent` window | Renders binding infeasible (see §2.2). Cannot attach after page load. |
| Enterprise/policy-installed extension | Infobar may not appear for policy-installed extensions | Only relevant for org-wide managed deployments; not for general users. |
| Session-long attach with explicit UI | Infobar is visible; Birdbrain can frame it in its own UI as "TLS binding active" | Honest and transparent; aligns with the forensic tool's chain-of-custody model. |

The only viable mitigation for general users is the last row: surface the infobar as a deliberate, opt-in feature of a recording session ("TLS binding mode"), with clear UI in Birdbrain's session controls showing whether TLS binding is active or not.

### 4.3 UX acceptability judgment

For a court-admissibility forensic tool used by investigators who are aware they are running a capture session, the infobar is arguably *honest disclosure* rather than a defect. The user is, in fact, running a tool that is instrumenting their browser's network layer. The infobar is consistent with that reality. This makes the infobar more acceptable for Birdbrain than for a casual productivity extension.

However, the infobar on all windows (not just the investigation window) may surprise investigators who have other Chrome windows open for personal use. This is a real UX concern to validate with users before committing to a session-long binding mode.

---

## 5. Corroboration-only fallback: Node TLS re-fetch

### 5.1 Mechanism

From `src/main` (Electron main process), a Node `tls.connect()` or `https.request()` to the captured URL, immediately after the capture is stored. `socket.getPeerCertificate(true)` (the `true` flag requests the full chain) returns an `issuerCertificate`-linked chain from leaf to root.

```typescript
import * as tls from 'tls'
const socket = tls.connect({
  host: parsedUrl.hostname,
  port: 443,
  servername: parsedUrl.hostname, // required for SNI
  agent: false,                   // prevents TLS session resumption eliding the cert
  rejectUnauthorized: true,
}, () => {
  const chain = socket.getPeerCertificate(true)
  socket.destroy()
  // walk chain via cert.issuerCertificate
})
```

Source: [Node.js TLS docs — getPeerCertificate](https://nodejs.org/docs/latest/api/tls.html); [Stack Overflow — full certificate chain Node.js](https://stackoverflow.com/questions/59773555/)

### 5.2 What it proves

- The origin was reachable at re-fetch time.
- At re-fetch time, the origin was serving a certificate with these specific fields (subject, SAN, issuer, validFrom/To, fingerprint).
- The certificate chain was trusted by the Node.js/OS trust store at re-fetch time.

### 5.3 What it does NOT prove

- That this is the same certificate served on the specific captured HTTP transaction. Between the capture and the re-fetch (typically seconds to minutes), a certificate rotation, CDN failover to a different PoP, or a redirect to a different origin could produce a different cert.
- Anything about HSTS, HPKP, or CT policy at the time of capture.

### 5.4 Known caveats

- **TLS session resumption:** `agent: false` must be passed; otherwise the Node HTTPS agent may resume a prior TLS session, skipping the full handshake and returning an empty cert. Source: [Node.js issue #7672](https://github.com/nodejs/node/issues/7672)
- **SNI:** `servername` must match the hostname in the URL, not the IP. Required for SNI-based virtual hosting.
- **Redirects:** A URL that redirects (HTTP 301/302) may resolve to a different origin. The cert recorded is for the final resolved origin, not the initially captured URL's server.
- **Time skew:** Time delta between capture and re-fetch is recorded as metadata; reviewers should understand what this interval represents. Recommend storing both timestamps.

### 5.5 Evidentiary weight

Corroboration-only mode supports the following statement: "At time T+Δ after capture, the origin was serving a certificate with these properties, consistent with what we expected to see at capture time." For most investigative use cases where the target site is not expected to rotate certs between capture and re-fetch, this is useful corroborating evidence. For cases where CDN routing or cert rotation is suspected, it is weaker.

---

## 6. Integration architecture considerations

### 6.1 Where CDP attach would live

CDP attach must live in the **extension background service worker** (`extension/src/background.ts`), not in the main process. Only the extension has access to `chrome.debugger` and the Chrome tab model. The cert data would be extracted in the SW and included in the `sendMhtmlCapture` payload (via `extension/src/utils/api.ts`), adding a `tlsCertChain` field to `IngestParams` (`src/main/services/captureLifecycle.ts`).

### 6.2 Session-long attach integration points

A session-long attach would need to be triggered when the user starts a recording session (the existing `startSession` → `sessionActive = true` path in `background.ts`). The attach/detach lifecycle would need to track the active session's tab and handle the `target_closed` re-attach loop. This is a non-trivial addition to the background service worker.

Key integration risks:
- `target_closed` re-attach races with `requestWillBeSent` (see §3.3).
- The SW state for attached tabs must survive SW restarts via `chrome.storage.session` (in-memory, survives SW sleep but not browser restart).
- If the user opens DevTools on the captured tab, the debugger is detached and `securityDetails` will be missing for subsequent captures until re-attach completes.

### 6.3 Corroboration-only integration points

The Node re-fetch lives entirely in `src/main` and is simpler: after `ingestMhtmlCapture` completes, fire-and-forget a `tls.connect()` to the capture URL, store the chain fields, and associate them with the capture record in SQLite. No extension changes required; no manifest permission changes required.

---

## 7. Recommended scope for #123

### 7.1 Primary recommendation: corroboration-only

Implement the Node TLS re-fetch in `src/main`. Store chain fields (subject, SANs, issuer, validFrom/To, fingerprint, protocol, cipher, re-fetch timestamp) in SQLite alongside the capture. Surface in the capture detail view.

Rationale:
- Zero extension manifest changes; zero UX surface changes for the infobar concern.
- Deterministic behavior (no timing races, no cached-response gaps).
- Delivers meaningful court-admissibility improvement: investigators can state "the cert chain at re-fetch time is on record."
- Does not foreclose binding: the corroboration-only path can be shipped now; binding mode can be added as an explicit opt-in feature in a follow-up.

### 7.2 If binding mode is pursued (follow-up, not #123)

The binding mode should be designed as an explicit opt-in feature:
- Added to session controls: "Enable TLS binding (shows browser debugging notice)"
- Session-long attach, Chrome 118+ floor
- `chrome.storage.session` for tab/session state
- Re-attach on `target_closed` with a short grace period
- Graceful fallback to corroboration-only when `securityDetails` is null (cached response) or detach occurs
- The infobar framed in Birdbrain's own UI as an expected, disclosed behaviour

Binding mode adds real forensic value in investigations of live, freshly-navigated pages. It is worth the engineering investment if users will tolerate the infobar UX.

---

## 8. Open questions for follow-up validation

1. **Cache hit rate in real investigations:** how often are captured pages served from Chrome's disk cache? If most targets are sites the investigator has visited before, the effective binding hit rate may be much lower than 70–85%.

2. **Infobar user research:** do Birdbrain's target users (investigators, legal professionals) find the "debugging this browser" infobar alarming, or do they understand it as consistent with running a forensic tool? This gates the binding mode UX decision.

3. **Cross-origin navigation race timing:** hands-on validation of the re-attach window is needed. The ≤200 ms re-attach estimate is based on community reports, not a Birdbrain-specific benchmark. Prototype needed.

4. **`Network.getCertificate` for full DER chain:** this experimental CDP command can return DER-encoded cert bytes, enabling signature verification. Its reliability and extension-API availability should be tested in a hands-on prototype before including it in the binding-mode design.

5. **Re-fetch TLS session resumption at scale:** the `agent: false` workaround creates a new TLS session for every re-fetch. For high-volume capture sessions, this may add latency. Whether an alternate approach (custom HTTPS agent with `maxCachedSessions: 0`) is preferable needs evaluation.

6. **SQLite schema for chain storage:** the current `captures` table schema (`src/main/services/database.ts`) does not have TLS cert fields. The migration version (currently v12) will need a bump. Column cardinality (one row per cert in chain vs. JSON blob) should be decided.

---

## Sources cited

| Source | URL | Used for |
|---|---|---|
| Chrome Extension SW Lifecycle | https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle | SW termination rules; Chrome 118 keepalive |
| Chrome Known Issues / Platform Gap | https://developer.chrome.com/docs/extensions/develop/migrate/known-issues | Chrome 118 debugger keepalive confirmation |
| chrome.debugger API Reference | https://developer.chrome.com/extensions/debugger.html | API shape, `DetachReason`, flat sessions |
| CDP Network domain SecurityDetails | https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-SecurityDetails | Field schema |
| Scrapfly CDP reference | https://scrapfly.io/docs/cloud-browser-api/cdp-reference/Network | SecurityDetails field list confirmation |
| Puppeteer HTTPResponse.ts | https://github.com/puppeteer/puppeteer/blob/eee111be/packages/puppeteer-core/src/cdp/HTTPResponse.ts | securityDetails null handling, fromDiskCache |
| Chromium infobar strings | https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/app/resources.grd | Infobar text and persistence behaviour |
| SO — Clear infobar after debug mode | https://stackoverflow.com/questions/63441002 | Infobar linger after detach; --silent-debugger-extension-api |
| SO — Infobar on all windows | https://stackoverflow.com/questions/78420135 | Browser-wide (not tab-specific) infobar |
| SO — getResponseBody no resource found | https://stackoverflow.com/questions/77643816 | Must-attach-before-requestWillBeSent constraint |
| openclaw issue #15099 | https://github.com/openclaw/openclaw/issues/15099 | MV3 SW state amnesia; production failure modes |
| openclaw PR #15817 | https://github.com/openclaw/openclaw/pull/15817 | Production MV3 debugger resilience patterns |
| scout-mcp chrome-extension.md | https://github.com/stemado/scout-mcp/blob/main/docs/chrome-extension.md | Infobar UX note; SW reconnect patterns |
| Node.js TLS docs | https://nodejs.org/docs/latest/api/tls.html | getPeerCertificate full chain |
| SO — full cert chain Node.js | https://stackoverflow.com/questions/59773555 | Chain traversal via issuerCertificate |
| Node.js issue #7672 | https://github.com/nodejs/node/issues/7672 | TLS session resumption / agent: false workaround |
| Puppeteer issue #719 | https://github.com/puppeteer/puppeteer/issues/719 | securityDetails structure; getCertificate redirect limitation |
