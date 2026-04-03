# Selector Scoping & Active Case Sync

## Problem

Selectors from all non-archived cases are sent to the Chrome extension for page matching, causing cross-case contamination. Additionally, OS-level notifications fire on matches, the extension doesn't rehighlight after creating a new selector, and the desktop app and extension have loosely-coupled active case state.

## Hard Constraints

- Only one case can be active at a time across the entire system.
- Selectors must only match against the active case — never across cases.
- No OS-level notifications from Chrome about selector matches.
- The active case must be selectable and changeable via a picklist in both the extension popup and the desktop app.
- Creating a selector from the extension must immediately rehighlight the current page.

## Changes

### 1. Scope `listActiveSelectors()` to Active Case Only

**File:** `src/main/services/database.ts`

The `listActiveSelectors()` function currently queries all enabled selectors from all non-archived cases. Change it to accept an optional `caseId` parameter. When provided, filter the query to `WHERE s.case_id = ? AND s.enabled = 1`.

**File:** `src/main/services/captureServer.ts`

The `/api/selectors/active` endpoint currently calls `db.listActiveSelectors()` with no filter. Change it to pass `state.activeCaseId` so only the active case's selectors are returned. If no case is active, return an empty array.

**File:** `src/main/ipcHandlers.ts`

The `SELECTORS_LIST_ACTIVE` handler calls `db.listActiveSelectors()`. Import the session state and pass the active case ID.

### 2. Remove OS Notifications

**File:** `extension/src/background.ts`

In `checkSelectorsOnTab()`, remove the `chrome.notifications.create()` call in the else branch (notify mode). The in-page highlights and badge count are sufficient. The badge update (`chrome.action.setBadgeText`) should remain.

Also remove the `notifications` permission from the extension manifest if present.

### 3. Live Rehighlight After Selector Creation

**File:** `extension/src/background.ts`

After a successful `createSelector()` call in the context menu handler:
1. Re-fetch active selectors: `activeSelectors = await getActiveSelectors()`
2. Get the current active tab
3. Call `checkSelectorsOnTab(tabId, url)` to re-run matching with the updated selector list

This ensures the newly created selector's matches appear immediately without a page reload.

### 4. Bidirectional Active Case Sync

**Desktop app notifies server on case navigation:**

**File:** `src/renderer/components/cases/CaseSwitcher.tsx` (or the route-level component)

When the user navigates to a case in the desktop app, fire an IPC call to `cases:activate` which sets `state.activeCaseId` on the server. This keeps the server-side state in sync with the desktop UI's URL routing.

Add a new IPC channel `CASES_ACTIVATE` in `src/shared/ipc.ts` that calls through to `captureServer`'s state, or reuse the existing HTTP endpoint logic via a direct function call.

**Extension detects active case changes:**

**File:** `extension/src/background.ts`

In the `checkStatus()` poll, compare the newly fetched `activeCaseId` with the previous value. If it changed:
1. Update `activeSelectors` (already happens)
2. Clear highlights on all tabs (`CLEAR_HIGHLIGHTS` message)
3. Re-run `checkSelectorsOnTab()` on the active tab with the new selectors

**File:** `extension/src/popup/popup.tsx`

The popup currently hides the case picker once a case is active. Change it to always show a dropdown/picklist at the top that displays the current active case and allows switching. The `CaseSelector` component already exists — adapt it to always render as a `<select>` or compact dropdown rather than a full list.

### 5. Desktop App Active Case Picker

**File:** `src/renderer/components/cases/CaseSwitcher.tsx`

This component already exists as a dropdown in the top bar. Ensure that selecting a case also calls the server's activate endpoint (new IPC channel) so the extension picks up the change on its next poll.

## Data Flow After Changes

```
User selects case (desktop or extension)
  -> Server state.activeCaseId updated
  -> Extension poll detects change
  -> Extension fetches selectors for active case only
  -> Extension clears old highlights, re-scans active tab
  -> Content script highlights only active case's selector matches
```

```
User creates selector via right-click
  -> POST /api/selectors (scoped to active case)
  -> Extension re-fetches active selectors
  -> Extension re-runs checkSelectorsOnTab on current tab
  -> Content script rehighlights with new selector included
```

## Files Modified

| File | Change |
|------|--------|
| `src/main/services/database.ts` | `listActiveSelectors()` accepts optional `caseId` param |
| `src/main/services/captureServer.ts` | `/api/selectors/active` passes `state.activeCaseId` |
| `src/main/ipcHandlers.ts` | `SELECTORS_LIST_ACTIVE` passes active case ID; new `CASES_ACTIVATE` handler |
| `src/shared/ipc.ts` | Add `CASES_ACTIVATE` channel |
| `extension/src/background.ts` | Remove notifications, add rehighlight after selector creation, detect case changes |
| `extension/src/popup/popup.tsx` | Always show case picker as dropdown |
| `src/renderer/components/cases/CaseSwitcher.tsx` | Call activate endpoint on case switch |
| `extension/manifest.json` | Remove `notifications` permission if present |

## Out of Scope

- Selector management UI in the extension popup (create/edit/delete from popup)
- Real-time push from server to extension (polling is sufficient at 5-30s intervals)
- Multi-tab simultaneous highlighting coordination
