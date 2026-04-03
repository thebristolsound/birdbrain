# Selector from Highlighted Text — Design Spec

**Date:** 2026-03-28
**Status:** Draft

## Summary

Add the ability to create a new selector from highlighted text in the browser via the Chrome extension's right-click context menu. The selector is instantly created against the active case and retroactive matching runs asynchronously.

## User Flow

1. User highlights text on a web page
2. Right-clicks → selects "Create Selector from Selection"
3. Extension sends the selected text to the capture server
4. Server creates a literal selector scoped to the active case
5. Toast confirms "Selector created"
6. Retroactive matching against existing captures runs asynchronously
7. User sees matches when they open the selectors view in the Electron app

## Approach

**Extension → Capture Server → Database** (Approach A). The extension POSTs to a new `/api/selectors` endpoint on the Hono capture server. The server creates the selector in SQLite and schedules retroactive matching. This follows the same communication pattern as captures (extension → Hono → DB) and requires no new transport layers.

## Data Flow

```
User highlights text → Right-click → "Create Selector from Selection"
  ↓
Background script: reads info.selectionText
  ↓
Background script: POST /api/selectors
  { caseId, pattern, isRegex: false, label: "from <hostname>" }
  ↓
Capture server (captureServer.ts):
  1. Validate (session active, case exists, pattern non-empty)
  2. db.createSelector({ caseId, pattern, isRegex: false, label })
  3. Return { selector, status: 'ok' }
  4. setImmediate: fetch capture texts → db.matchSelectorAgainstCaptures()
  ↓
Background script: receive response
  ↓
Content script: show success toast ("Selector created")
```

## API

### `POST /api/selectors`

**Request:**
```json
{
  "caseId": "string",
  "pattern": "string",
  "label": "string (optional)"
}
```

**Response 200:**
```json
{
  "selector": { "id": "...", "caseId": "...", "pattern": "...", "isRegex": false, "enabled": true, "label": "...", "createdAt": "..." },
  "status": "ok"
}
```

**Error responses:**
- `400` — no active session, missing/empty pattern, missing caseId
- `404` — case not found

**Retroactive matching:** Runs asynchronously via `setImmediate` after the response is sent. The response does not include match count. Matches populate in the DB and are visible in the Electron app's selector views on next load/refresh.

## Context Menu

### New menu item

| Property | Value |
|----------|-------|
| ID | `SELECTOR_CONTEXT_MENU_ID` |
| Title | `"Create Selector from Selection"` |
| Contexts | `['selection']` |
| Enabled | When connected AND session active AND active case set |

Chrome's `contexts: ['selection']` ensures the item only appears when text is highlighted. The enabled/disabled state is managed alongside the existing capture menu item in the status polling logic.

### Existing menu item (unchanged)

| Property | Value |
|----------|-------|
| ID | `CAPTURE_CONTEXT_MENU_ID` |
| Title | `"Capture with Birdbrain"` |
| Contexts | `['page']` |

### Selection text handling

- `info.selectionText` provides the highlighted text as plain text (no HTML)
- This becomes the literal `pattern` (selectors created this way are never regex)
- Auto-generated `label`: `"from <hostname>"` (e.g., `"from reddit.com"`) for provenance when viewing in the app

## Toast Feedback

Reuses the existing toast system in the content script (`SHOW_CAPTURE_TOAST` / `UPDATE_CAPTURE_TOAST` messages). States:

| State | Message |
|-------|---------|
| Capturing | `"Creating selector..."` |
| Success | `"Selector created"` |
| Error | `"Failed to create selector"` |

No changes to `extension/src/content.ts` or `extension/src/toast.ts` required.

## Server-Side Changes

### `src/main/services/captureServer.ts`

Add `POST /api/selectors` route alongside the existing `GET /api/selectors/active`:

1. **Validate** — parse JSON body, check session is active, pattern is non-empty string, caseId resolves to an existing case
2. **Create** — call `db.createSelector({ caseId, pattern, isRegex: false, label })`
3. **Respond** — return `{ selector, status: 'ok' }`
4. **Async matching** — `setImmediate` → fetch all capture texts for the case → call `db.matchSelectorAgainstCaptures(selectorId, captureTexts)`

Error handling follows the same pattern as the capture endpoint (JSON error responses with `status` and `error` fields).

### No new IPC channels

The Electron app's selector hooks refresh from the DB when the user navigates to the selectors view. No real-time push notification is needed for a low-frequency action like selector creation.

## Extension Changes

### `extension/src/background.ts`

- Add `SELECTOR_CONTEXT_MENU_ID` constant
- Register second context menu item in `chrome.runtime.onInstalled` with `contexts: ['selection']`
- Add handler in `chrome.contextMenus.onClicked` that:
  1. Reads `info.selectionText`
  2. Derives label from tab URL hostname
  3. Shows "Creating selector..." toast via content script
  4. Calls `api.createSelector({ caseId: activeCaseId, pattern: info.selectionText, label })`
  5. Updates toast to success or error
- Toggle enabled/disabled state in the status polling logic alongside the existing capture menu item

### `extension/src/utils/api.ts`

- Add `createSelector(params: { caseId: string, pattern: string, label?: string })` function
- POSTs to `/api/selectors`, returns `{ selector, status }` or throws `ApiError`

### `extension/src/content.ts`

No changes. Existing toast infrastructure handles all required states.

## Files Modified

| File | Change |
|------|--------|
| `src/main/services/captureServer.ts` | Add `POST /api/selectors` route |
| `extension/src/background.ts` | Add context menu item + click handler |
| `extension/src/utils/api.ts` | Add `createSelector()` API method |

**No new files created.**

## Out of Scope

- Regex selector creation from the extension (always literal)
- Selector editing from the extension (edit in the Electron app)
- Case selection UI in the extension (uses active case only)
- Real-time push of new selectors to the Electron app UI
