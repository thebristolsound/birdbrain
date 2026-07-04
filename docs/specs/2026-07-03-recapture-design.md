# Recapture — background capture via hidden browser

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation

## Problem

Two gaps in the current capture flow:

1. **Thin captures.** A capture can miss lazy-loaded content, or the screenshot can fail or be
   dropped for size. Today the only fix is to revisit the page in Chrome and capture again by hand.
2. **Capture requires visiting.** Every capture requires the operator to open the page in their
   own browser with the extension attached. There is no way to capture a URL (or a list of URLs)
   without visiting it — a tradecraft and safety gap.

## Goals

- "Recapture" an existing capture's URL in the background, silently, producing a full MHTML
  capture plus a whole-page screenshot, linked to the original.
- Accept one or many pasted URLs and capture them in the background the same way.
- Reuse the existing forensic pipeline unchanged: SHA-256 hashing, hash-chained manifest,
  RFC 3161 timestamping, TLS cert corroboration, text extraction, selector matching.

## Non-goals (v1)

- Replacing or mutating the original capture (the manifest is append-only; recaptures are new
  entries).
- Logged-in captures. Background captures always run in a clean session; login-gated pages will
  capture as login walls.
- Persistent queue across app restarts, retry policies, scheduling/monitoring, or a dedicated
  queue management page.
- Hydrating legacy `format: 'html'` captures (a recapture of one is just a normal recapture of
  its URL).

## Capture engine decision

**Hidden Electron `BrowserWindow` in the main process.** Alternatives considered:

| Option | Verdict |
| --- | --- |
| Hidden `BrowserWindow` + `webContents.savePage('MHTML')` + CDP screenshot | **Chosen.** Zero new dependencies, no second Chromium to package, `browserVersion` provenance is the app's real Chromium. |
| Bundled headless Playwright/Puppeteer | ~150MB second Chromium, packaging complexity on three platforms, version drift between capturing browser and app. Overkill for v1. |
| Extension-driven background tab | Not silent (tab appears), requires Chrome running, fails the capture-without-visiting goal. |

Security posture for the hidden window (a hostile page runs in our process, so lock it down):
`show: false`, `sandbox: true`, `contextIsolation: true`, **no preload**, `nodeIntegration: false`,
a unique in-memory session partition per job, `setPermissionRequestHandler` denying everything,
`setWindowOpenHandler` → deny, and the window + session destroyed after every job.

## Data model & provenance

A background recapture is a different class of evidence than an operator-witnessed extension
capture — no operator eyes on the page, no extension, a different user agent. The model records
that honestly:

- **`CaptureMethod = 'extension' | 'background'`** — new field on `Capture` and on the manifest
  capture entry. DB migration v13; existing rows and new extension captures default `'extension'`.
- **`supersedesCaptureId?: string`** — new nullable field on `Capture`, also anchored in the
  manifest entry. Set when the job originated from "Recapture this capture"; absent for pasted
  URLs. The original capture is never touched — both remain fully visible ("linked sibling").
- **`CaptureSource`** gains `'recapture'` so activity events distinguish background jobs.
- Provenance fields for background captures: real `userAgent` and `browserVersion` from the hidden
  window's Chromium, `httpStatus` from the main-frame navigation response, `extensionVersion`
  undefined, `operatorId`/`operatorName` from settings as today.
- Manifest note: `method` and `supersedesCaptureId` are omitted from the canonical entry body when
  absent (same grandfathering convention as `headers`/`tls` in #119/#123), so existing entries'
  chain hashes are untouched.

## Recapture service (main process)

New `src/main/services/recapture.ts`.

### Queue

- In-memory FIFO, **concurrency 1** (serial): predictable resource use, honest timestamps.
- Job shape: `{ url, caseId, supersedesCaptureId? }`.
- Not persisted across restarts in v1. Jobs are seconds long; after a crash the user re-runs from
  the UI.

### Worker (per job)

1. Create the locked-down hidden window (above) with a fresh in-memory partition.
2. `loadURL(url)` → wait for `did-finish-load` plus a quiet period.
3. Programmatic scroll to bottom and back (via `webContents.executeJavaScript`) to trigger
   lazy-loaded content, then settle.
4. Full-page screenshot: attach `webContents.debugger`, CDP
   `Page.captureScreenshot { captureBeyondViewport: true }` → PNG buffer.
5. `webContents.savePage(tmpPath, 'MHTML')` → open as a stream.
6. Extract text via `executeJavaScript('document.body.innerText')` (same shape the extension
   sends).
7. Call the existing `ingestMhtmlCapture` with method/provenance fields; the untouched pipeline
   does hashing, manifest, sidecars, TSA enqueue, TLS corroboration, extraction, selectors.
8. Destroy window and session; delete the tmp file.

- **Hard timeout ~45s per job.** On timeout or any failure: emit a `failed` CaptureEvent with the
  error — no capture row, no manifest entry (existing rollback seams guarantee no partial
  artifacts).
- **Login-wall heuristic (soft):** if the final URL redirected off-origin or the title/body
  matches common login patterns, **still store the capture** (what the clean session saw is still
  evidence) but flag the completion event with a warning.
- The window layer is injectable — `renderPage(url) → { mhtmlStream, screenshot, text, meta }` —
  same DI style as `fetchTlsCertChain`, so unit tests never open real windows.

## IPC + UI

- New IPC channels: `recapture:enqueue` (`{ urls: string[], caseId, supersedesCaptureId? }`),
  `recapture:queueStatus`; progress reuses the existing capture-activity event shape with
  `source: 'recapture'`.
- **Entry points (lightweight v1):**
  - "Recapture" action in the CaptureViewer action area and the CaptureItem context menu.
  - "Add URLs" affordance on the Captures tab accepting pasted newline/space-separated URLs
    (validated, deduped before enqueue).
- **Feedback:** jobs flow through the existing activity feed; a small pending-count badge near the
  capture health/status area; the new capture appears in the list on completion.
- **Supersession UI:** two-way link chip in the viewer — "Recaptured →" on the original,
  "← Recapture of" on the new capture. Neither is hidden or demoted.

## Error handling

- Failure modes: navigation error, timeout, screenshot/CDP failure, savePage failure, ingest
  failure. All surface as `failed` CaptureEvents with the error message; none leave partial
  artifacts.
- Oversized MHTML hits the existing `MAX_MHTML_SIZE` cap inside `streamWriteAndHash` and fails the
  job cleanly.
- Malformed pasted URLs are rejected at enqueue with per-URL feedback, not silently dropped.

## Testing

- **Unit (vitest):** queue ordering/serialism, provenance fields on the ingested capture,
  supersedes linkage, migration v13, login-wall heuristic, failure → event (window layer stubbed
  behind the `renderPage` seam).
- **E2E (Playwright + Electron):** serve a fixture page locally, recapture it, assert the new
  capture exists with `method: 'background'`, the supersedes link renders both ways, and the
  manifest chain verifies.

## Open questions deferred past v1

- Persistent recapture profile for login-gated sites (explicitly rejected for v1: clean session
  only).
- Queue persistence, retries, and a dedicated queue view.
- Scheduled/recurring recapture for change monitoring.
