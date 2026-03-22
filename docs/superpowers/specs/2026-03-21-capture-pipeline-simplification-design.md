# Capture Pipeline Simplification & Observability

**Date:** 2026-03-21
**Status:** Approved
**Approach:** Simplify + Observe (Approach B)

## Problem Statement

The capture pipeline is overcomplicated and error-prone. There are three nearly-identical capture endpoints with duplicated logic. The two-phase manual capture design introduces silent failures where Phase 2 (freeze-dry) can fail without any user feedback. There is no observability into the pipeline — no way to confirm captures are working, no health dashboard, and no test tooling.

### Specific Issues

1. **Three endpoints** (`/api/captures`, `/api/captures/manual`, `/api/captures/selector`) duplicate ~80% of their logic with source-specific validation sprinkled in.
2. **Two-phase manual capture** shows "Captured!" immediately (Phase 1: raw HTML) then fires off freeze-dry in the background (Phase 2). Phase 2 failures are caught and logged but never surfaced to the user.
3. **Async post-capture work** (entity extraction, selector matching) runs via `setImmediate()` with errors logged but not propagated. The `NEW_CAPTURE` IPC event fires before extraction completes.
4. **No network resilience** in extension API client — no retries, no timeouts, no backoff.
5. **No observability** — no capture activity log, no health indicators, no way to test the pipeline end-to-end.

## Design

### 1. Unified Capture Endpoint

Replace three endpoints with a single `POST /api/captures`.

**Request body:**

```typescript
interface CaptureRequest {
  source: 'auto' | 'manual' | 'selector'
  caseId?: string        // required for manual/selector, inferred from active case for auto
  url: string
  title: string
  html: string
  screenshot?: string    // base64-encoded PNG
  timestamp: string
  textContent?: string
  headers?: Record<string, string>
  matchedSelectors?: SelectorMatchInfo[]  // only for selector source
}
```

**Validation rules by source:**

| Source | Session required? | caseId | Extra validation |
|--------|------------------|--------|------------------|
| `auto` | Yes | Inferred from active case | Dedup remains client-side in extension (60s window) |
| `manual` | No | Required, must exist and not be archived | None |
| `selector` | No | Required, must exist | `matchedSelectors` required |

All sources share: URL + HTML required, URL blacklist check, file storage, DB insert, entity extraction.

**Note on dedup:** Deduplication for auto-captures stays in the extension's `background.ts` (`shouldCapture()` check) — the server does not perform dedup. This preserves the current behavior and avoids adding server-side state. The `skipped` response status is returned when the extension detects a dedup hit before sending to the server (the extension simply doesn't send the request).

**Unified handler decision tree:**

```
POST /api/captures handler:
  1. Parse body, validate url + html present → 400 if missing
  2. Check URL blacklist → 403 if blocked
  3. Switch on source:
     ├── 'auto':
     │   ├── Check state.sessionActive → 400 if not active
     │   ├── Use state.activeCaseId as caseId → 400 if no active case
     │   └── Continue to shared pipeline
     ├── 'manual':
     │   ├── Require body.caseId → 400 if missing
     │   ├── Look up case, check not archived → 404/400
     │   └── Continue to shared pipeline
     └── 'selector':
         ├── Require body.caseId → 400 if missing
         ├── Require body.matchedSelectors → 400 if missing
         ├── Look up case → 404 if not found
         └── Continue to shared pipeline
  4. Shared pipeline:
     ├── Emit CaptureEvent { type: 'received' }
     ├── saveCapture() (files + DB)
     ├── Emit CaptureEvent { type: 'stored' }
     ├── Schedule entity extraction via setImmediate()
     ├── Send NEW_CAPTURE IPC to renderer
     └── Return 201 { captureId, hash, status: 'ok', source }
  5. On error:
     ├── Emit CaptureEvent { type: 'failed', error }
     └── Return appropriate HTTP status
```

**Response:**

```typescript
interface CaptureResponse {
  captureId: string
  hash: string
  status: 'ok' | 'skipped'  // skipped = dedup hit
  source: string
}
```

**Removed endpoints:**
- `POST /api/captures/manual`
- `POST /api/captures/selector`
- `PATCH /api/captures/:id/html`

**CORS update:** Remove `PATCH` from `allowMethods` in CORS config (only `GET` and `POST` needed after this change).

**New test endpoint:**
- `GET /api/captures/test` — extension round-trip test (see Section 6)

### 2. Simplified Extraction Flow (Extension Side)

Drop the two-phase capture entirely. Single extraction path for all capture types.

**Flow:**

```
User triggers capture (context menu / auto / selector)
  → Show toast: "Capturing..."
  → Parallel:
  │   ├── EXTRACT_PAGE (freeze-dry, 10s timeout, fallback to raw HTML)
  │   └── captureVisibleTab() (screenshot)
  → POST /api/captures { source, ... }
  → On success: toast "Page captured"
  → On degraded: toast "Captured (basic snapshot)" (freeze-dry failed, raw HTML saved)
  → On failure: toast "Capture failed: {reason}"
  → On skip: toast "Already captured" (dedup)
```

**Changes:**
- Remove `EXTRACT_PAGE_FAST` content script message handler entirely
- Remove `sendManualCapture()`, `sendSelectorCapture()`, `updateCaptureHtml()` from extension API
- Collapse to single `sendCapture(data: CaptureRequest)` function
- Remove Phase 2 background logic from `background.ts`

**Latency trade-off:** Manual capture goes from ~100ms to ~500ms-2s (freeze-dry time). Acceptable for honest feedback and simpler code. The 10s timeout prevents hangs on complex pages.

### 3. Capture Event System

New IPC event channel for capture pipeline observability.

**IPC channel:** `event:captureActivity`

**Event structure:**

```typescript
interface CaptureEvent {
  type: 'received' | 'stored' | 'failed' | 'skipped' | 'extraction_done'
  captureId?: string
  source: 'auto' | 'manual' | 'selector'
  url: string
  timestamp: string
  error?: string           // only for 'failed'
  skipReason?: string      // only for 'skipped' (dedup, blacklist)
  durationMs?: number      // time from received to stored
}
```

**Emission points in capture server:**
- `received` — when request hits the endpoint
- `stored` — after file write + DB insert succeed
- `failed` — on any error (validation, storage, DB)
- `skipped` — on dedup hit or blacklist match
- `extraction_done` — after entity extraction completes (or fails)

### 4. Health Dashboard (Status Bar Popover)

New component: `src/renderer/components/status/CaptureHealth.tsx`

Accessible via a clickable indicator in the bottom status bar that expands to a popover panel.

**Contents:**
1. **Connection indicator** — extension connected / disconnected (existing, reuse)
2. **Recent capture activity** — scrollable list of last 50 capture events with status icons:
   - Green check: stored successfully
   - Red X: failed
   - Yellow skip: dedup/blacklist
   - Blue info: extraction complete
3. **Aggregate stats** — captures in last hour: N succeeded, N failed, N skipped
4. **Last error** — most recent failure with timestamp and error message
5. **Pipeline status** — server running? Extension connected? Session active? Entity extraction enabled?
6. **Test buttons** — "Test Pipeline" and "Test Extension" (see Section 6)

**Data flow:**

```
Capture server emits CaptureEvent
  → Main process sends via IPC event:captureActivity
  → Renderer appStore stores events in ring buffer (last 50)
  → CaptureHealth component renders from store
```

**Store additions to appStore:**

```typescript
// New state
captureEvents: CaptureEvent[]          // ring buffer, last 50
captureStats: {
  successCount: number
  failCount: number
  skipCount: number
  lastError?: { message: string; timestamp: string }
}

// New actions
addCaptureEvent: (event: CaptureEvent) => void
clearCaptureEvents: () => void
```

### 5. Extension Feedback Overhaul

Toasts reflect actual capture outcome. No premature success messages.

**Toast states:**

| State | Icon | Message | Auto-dismiss |
|-------|------|---------|-------------|
| Capturing | Spinner | "Capturing page..." | No (stays until done) |
| Success | Green check | "Page captured" | 3s |
| Degraded | Amber warning | "Captured (basic snapshot)" | 5s |
| Failed | Red X | "Capture failed: {reason}" | 5s |
| Skipped | Gray info | "Already captured" | 2s |

**Error categorization by HTTP status:**

| HTTP Status | User-facing message |
|-------------|-------------------|
| 200/201 | "Page captured" |
| 400 | "Capture rejected: {server detail}" |
| 403 | "URL is blacklisted" |
| 404 | "Case not found" |
| 500 | "Server error — check Birdbrain app" |
| Network error | "Can't reach Birdbrain — is it running?" |

**Badge changes:**
- Existing behavior preserved (count, "!", match indicators)
- Add brief red flash on capture failure

### 6. Test Capture Buttons

Two test mechanisms, accessible from the health dashboard popover.

**Server Pipeline Test (IPC):**

- IPC channel: `captures:testPipeline`
- Flow: Creates test HTML payload → saves via `saveCapture()` → reads back from storage → verifies SHA-256 hash → cleans up test capture from DB and disk
- Returns: `{ success: boolean, durationMs: number, error?: string }`
- Button label: "Test Pipeline"
- Result shown inline: "Pipeline OK — verified in {N}ms" or "Pipeline FAILED: {error}"

**Extension Round-Trip Test (HTTP):**

- Endpoint: `GET /api/captures/test`
- Flow: Main process makes HTTP request to its own Hono server → server creates test capture → verifies → cleans up → returns result
- Returns: `{ success: boolean, durationMs: number, error?: string }`
- Button label: "Test Extension"
- Triggered from health dashboard via IPC → main process makes the HTTP call directly (does NOT require extension to be connected; tests the HTTP server + storage pipeline)
- Result shown inline in health dashboard
- **Note:** This tests the HTTP endpoint path specifically. Extension connectivity is already shown by the connection indicator.

**Cleanup safety:** Both test mechanisms wrap cleanup in try/finally to prevent orphaned test data on cleanup failure.

## Extension API Changes

**Before (6 capture functions):**
- `sendCapture()` → `POST /api/captures`
- `sendManualCapture()` → `POST /api/captures/manual`
- `sendSelectorCapture()` → `POST /api/captures/selector`
- `updateCaptureHtml()` → `PATCH /api/captures/:id/html`
- `getActiveSelectors()` → `GET /api/selectors/active`
- `checkConnection()` → `GET /api/status`

**After (2 capture-specific functions + 2 unchanged utility functions):**
- `sendCapture(data: CaptureRequest)` → `POST /api/captures` (replaces 3 old functions)
- `testCapturePipeline()` → `GET /api/captures/test` (new)
- `getActiveSelectors()` → `GET /api/selectors/active` (unchanged)
- `checkConnection()` → `GET /api/status` (unchanged)

**Note:** Non-capture functions (`getCases()`, `activateCase()`, `startSession()`, `stopSession()`, `getEntitySummary()`) are unchanged. The `CaptureResult` interface in `api.ts` gains a `source` field to match the new `CaptureResponse`.

## IPC Changes

**New channels:**
- `event:captureActivity` — main → renderer, capture pipeline events
- `captures:testPipeline` — renderer → main, server pipeline test

**Unchanged channels:**
- All existing capture channels (`captures:list`, `captures:get`, `captures:delete`, `captures:getContent`)
- `event:newCapture` — still emitted when a capture is stored

## Files Changed

### Extension
- `extension/src/background.ts` — remove two-phase logic, unify capture calls, update toast handling
- `extension/src/content.ts` — remove `EXTRACT_PAGE_FAST` handler
- `extension/src/utils/api.ts` — collapse to single `sendCapture()`, add `testCapturePipeline()`

### Main Process
- `src/main/services/captureServer.ts` — consolidate to single endpoint, add event emission, add test endpoint
- `src/main/ipcHandlers.ts` — add `captures:testPipeline` handler, add `event:captureActivity` forwarding

### Shared
- `src/shared/ipc.ts` — add new channel constants (`CAPTURE_ACTIVITY`, `CAPTURES_TEST_PIPELINE`)
- `src/shared/types.ts` — add `CaptureEvent` interface, add `CaptureSource` type (all domain types live here, not in ipc.ts)

### Preload
- `src/preload/index.ts` (or equivalent) — expose `event:captureActivity` subscription and `captures:testPipeline` invoke to the renderer bridge

### Renderer
- `src/renderer/stores/appStore.ts` — add capture events state and actions
- `src/renderer/hooks/useServerStatus.ts` — subscribe to `event:captureActivity`
- `src/renderer/components/status/CaptureHealth.tsx` — new component (health dashboard popover)
- `src/renderer/components/status/ConnectionStatus.tsx` — integrate with CaptureHealth trigger

### Tests
- `tests/main/services/captureServer.test.ts` — rewrite for unified endpoint, add event emission tests, add test endpoint tests

## Migration Notes

- The extension API changes are breaking — extension must be rebuilt alongside main app
- No database schema changes required
- No storage format changes
- Existing captures unaffected
