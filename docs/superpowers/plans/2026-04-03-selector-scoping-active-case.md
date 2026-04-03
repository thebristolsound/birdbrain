# Selector Scoping & Active Case Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope selector matching to the active case only, remove OS notifications, add live rehighlight, and sync active case between desktop and extension.

**Architecture:** The server-side `state.activeCaseId` is the single source of truth. `listActiveSelectors()` is filtered to only return selectors for the active case. The extension detects case changes via its existing status poll and re-scans tabs. The popup always shows a case picker dropdown.

**Tech Stack:** Electron, TypeScript, better-sqlite3, Chrome Extension MV3, React, Hono

---

### Task 1: Scope `listActiveSelectors()` to Active Case

**Files:**
- Modify: `src/main/services/database.ts:485-508` — `listActiveSelectors()`
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write failing test for scoped `listActiveSelectors`**

Add to the imports at the top of `tests/main/services/database.test.ts`:

```ts
import {
  // ... existing imports ...
  listActiveSelectors
} from '@main/services/database'
```

Add a new describe block at the end (inside the top-level `describe('database', ...)`):

```ts
describe('listActiveSelectors', () => {
  it('returns only selectors for the specified case', () => {
    const case1 = createCase({ name: 'Case A' })
    const case2 = createCase({ name: 'Case B' })
    createSelector({ caseId: case1.id, pattern: 'alpha' })
    createSelector({ caseId: case2.id, pattern: 'beta' })

    const result = listActiveSelectors(case1.id)
    expect(result).toHaveLength(1)
    expect(result[0].caseId).toBe(case1.id)
    expect(result[0].selectors).toHaveLength(1)
    expect(result[0].selectors[0].pattern).toBe('alpha')
  })

  it('returns all enabled selectors when no caseId given', () => {
    const case1 = createCase({ name: 'Case A' })
    const case2 = createCase({ name: 'Case B' })
    createSelector({ caseId: case1.id, pattern: 'alpha' })
    createSelector({ caseId: case2.id, pattern: 'beta' })

    const result = listActiveSelectors()
    expect(result).toHaveLength(2)
  })

  it('returns empty array for unknown caseId', () => {
    const result = listActiveSelectors('nonexistent')
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/services/database.test.ts -t "listActiveSelectors"`

Expected: FAIL — `listActiveSelectors` does not accept a `caseId` argument yet, so the scoped test returns selectors from both cases.

- [ ] **Step 3: Implement scoped `listActiveSelectors`**

In `src/main/services/database.ts`, replace the `listActiveSelectors` function (lines 485-508):

```ts
export function listActiveSelectors(caseId?: string): ActiveCaseSelectors[] {
  let rows: Array<Record<string, unknown>>
  if (caseId) {
    rows = getDb()
      .prepare(
        `SELECT s.*, c.name as case_name FROM selectors s
         JOIN cases c ON s.case_id = c.id
         WHERE s.case_id = ? AND s.enabled = 1 AND c.archived = 0
         ORDER BY s.created_at DESC`
      )
      .all(caseId) as Array<Record<string, unknown>>
  } else {
    rows = getDb()
      .prepare(
        `SELECT s.*, c.name as case_name FROM selectors s
         JOIN cases c ON s.case_id = c.id
         WHERE s.enabled = 1 AND c.archived = 0
         ORDER BY c.name, s.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>
  }

  const grouped = new Map<string, ActiveCaseSelectors>()
  for (const row of rows) {
    const id = row.case_id as string
    if (!grouped.has(id)) {
      grouped.set(id, {
        caseId: id,
        caseName: row.case_name as string,
        selectors: []
      })
    }
    grouped.get(id)!.selectors.push(rowToSelector(row))
  }
  return Array.from(grouped.values())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/main/services/database.test.ts -t "listActiveSelectors"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat: scope listActiveSelectors to optional caseId parameter"
```

---

### Task 2: Scope the `/api/selectors/active` Endpoint and IPC Handler

**Files:**
- Modify: `src/main/services/captureServer.ts:368-372` — `/api/selectors/active` route
- Modify: `src/main/ipcHandlers.ts:259` — `SELECTORS_LIST_ACTIVE` handler
- Test: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Write failing test for scoped `/api/selectors/active`**

Add to `tests/main/services/captureServer.test.ts`, after the existing selector tests (around line 1020):

```ts
it('GET /api/selectors/active returns only selectors for active case', async () => {
  const case1 = createCase({ name: 'Active Case' })
  const case2 = createCase({ name: 'Other Case' })
  createSelector({ caseId: case1.id, pattern: 'target-person' })
  createSelector({ caseId: case2.id, pattern: 'other-person' })

  // Activate case1
  await fetch(`${baseUrl}/api/cases/${case1.id}/activate`, { method: 'POST' })

  const res = await fetch(`${baseUrl}/api/selectors/active`)
  const data = await res.json()
  expect(data).toHaveLength(1)
  expect(data[0].caseId).toBe(case1.id)
  expect(data[0].selectors).toHaveLength(1)
  expect(data[0].selectors[0].pattern).toBe('target-person')
})

it('GET /api/selectors/active returns empty when no case active', async () => {
  const case1 = createCase({ name: 'Some Case' })
  createSelector({ caseId: case1.id, pattern: 'some-pattern' })

  // Don't activate any case
  const res = await fetch(`${baseUrl}/api/selectors/active`)
  const data = await res.json()
  expect(data).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/services/captureServer.test.ts -t "selectors/active"`

Expected: FAIL — currently returns selectors from all cases.

- [ ] **Step 3: Update the `/api/selectors/active` endpoint**

In `src/main/services/captureServer.ts`, replace lines 368-372:

```ts
  // List active selectors for the active case only
  app.get('/api/selectors/active', (c) => {
    if (!state.activeCaseId) {
      return c.json([])
    }
    const activeSelectors = db.listActiveSelectors(state.activeCaseId)
    return c.json(activeSelectors)
  })
```

- [ ] **Step 4: Update the IPC handler**

In `src/main/ipcHandlers.ts`, replace line 259:

```ts
  ipcMain.handle(IPC_CHANNELS.SELECTORS_LIST_ACTIVE, () => {
    const { activeCaseId } = getSessionState()
    return db.listActiveSelectors(activeCaseId ?? undefined)
  })
```

Add the import at the top of `src/main/ipcHandlers.ts` (line 17, after the existing captureServer import):

```ts
import { getSessionState } from '@main/services/captureServer'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/captureServer.test.ts`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/captureServer.ts src/main/ipcHandlers.ts tests/main/services/captureServer.test.ts
git commit -m "feat: scope /api/selectors/active and IPC handler to active case"
```

---

### Task 3: Remove OS Notifications from Extension

**Files:**
- Modify: `extension/src/background.ts:438-452` — `checkSelectorsOnTab()` notify branch
- Modify: `extension/manifest.json:11` — remove `notifications` permission

- [ ] **Step 1: Remove the notification in `checkSelectorsOnTab`**

In `extension/src/background.ts`, replace lines 438-452 (the if/else block inside `checkSelectorsOnTab` after the badge update):

```ts
    if (autoCaptureMode === 'auto') {
      // Auto-capture for each matching case
      for (const [caseId] of caseMatches) {
        handleSelectorCapture(tabId, url, caseId)
      }
    }
```

This removes the entire `else` branch that called `chrome.notifications.create()`. In non-auto mode, the in-page highlights and badge count are the notification.

- [ ] **Step 2: Remove `notifications` permission from manifest**

In `extension/manifest.json`, remove `"notifications",` from the permissions array (line 11). The result should be:

```json
  "permissions": [
    "activeTab",
    "tabs",
    "scripting",
    "storage",
    "contextMenus"
  ],
```

- [ ] **Step 3: Build extension to verify no compile errors**

Run: `pnpm build:extension`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add extension/src/background.ts extension/manifest.json
git commit -m "fix: remove OS notifications for selector matches"
```

---

### Task 4: Live Rehighlight After Selector Creation

**Files:**
- Modify: `extension/src/background.ts:135-202` — context menu selector creation handler

- [ ] **Step 1: Add rehighlight after successful selector creation**

In `extension/src/background.ts`, replace the try block inside the `SELECTOR_CONTEXT_MENU_ID` handler (lines 168-181) with:

```ts
    try {
      await createSelector({
        caseId: activeCaseId,
        pattern: selectedText,
        label
      })

      chrome.tabs
        .sendMessage(tab.id, {
          type: 'UPDATE_CAPTURE_TOAST',
          status: 'success',
          message: 'Selector created'
        })
        .catch(() => {})

      // Re-fetch selectors and rehighlight current page
      try {
        activeSelectors = await getActiveSelectors()
        if (tab.url) {
          checkSelectorsOnTab(tab.id, tab.url)
        }
      } catch {
        // Non-critical — highlights will appear on next page load
      }
    } catch (err) {
```

Note: The catch block (lines 182-201) stays exactly as-is.

- [ ] **Step 2: Build extension to verify no compile errors**

Run: `pnpm build:extension`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: rehighlight page immediately after creating selector"
```

---

### Task 5: Extension Detects Active Case Changes and Re-scans

**Files:**
- Modify: `extension/src/background.ts:48-105` — `checkStatus()` function

- [ ] **Step 1: Add case-change detection to `checkStatus`**

In `extension/src/background.ts`, replace the `checkStatus` function (lines 48-105) with:

```ts
async function checkStatus(): Promise<void> {
  try {
    const status = await getStatus()
    const wasConnected = connected
    const previousCaseId = activeCaseId
    connected = status.running
    sessionActive = status.sessionActive
    captureCount = status.captureCount
    autoCaptureMode = status.autoCaptureMode || 'notify'
    availableCases = status.cases || []
    activeCaseId = status.activeCase?.id || null
    userIgnoredPatterns = status.ignoredUrlPatterns || []

    if (connected && !wasConnected) {
      updateIcon('connected')
    } else if (!connected && wasConnected) {
      updateIcon('disconnected')
    }

    if (sessionActive) {
      updateIcon('active')
      chrome.action.setBadgeText({ text: String(captureCount) })
    } else if (connected) {
      updateIcon('connected')
      chrome.action.setBadgeText({ text: '' })
    }

    // Fetch active selectors whenever connected
    if (connected) {
      try {
        activeSelectors = await getActiveSelectors()
      } catch {
        activeSelectors = []
      }
    } else {
      activeSelectors = []
    }

    // If active case changed, clear old highlights and re-scan active tab
    if (connected && activeCaseId !== previousCaseId) {
      // Clear highlights on all tabs
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: 'CLEAR_HIGHLIGHTS' }).catch(() => {})
          }
        }
      })

      // Re-scan the active tab with new case's selectors
      if (activeCaseId && activeSelectors.length > 0) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0]
          if (activeTab?.id && activeTab.url) {
            checkSelectorsOnTab(activeTab.id, activeTab.url)
          }
        })
      }
    }

    // Update context menu enabled state
    chrome.contextMenus
      .update(CONTEXT_MENU_ID, {
        enabled: connected && !!activeCaseId
      })
      .catch(() => {})
    chrome.contextMenus
      .update(SELECTOR_CONTEXT_MENU_ID, {
        enabled: connected && !!activeCaseId
      })
      .catch(() => {})
  } catch {
    connected = false
    sessionActive = false
    updateIcon('disconnected')
  }
}
```

- [ ] **Step 2: Build extension to verify no compile errors**

Run: `pnpm build:extension`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: detect active case changes and re-scan tabs"
```

---

### Task 6: Extension Popup Always Shows Case Picker

**Files:**
- Modify: `extension/src/popup/popup.tsx:266-307` — `CaseSelector` component
- Modify: `extension/src/popup/popup.tsx:454-479` — main render in `Popup`

- [ ] **Step 1: Replace `CaseSelector` with a compact dropdown**

In `extension/src/popup/popup.tsx`, replace the `CaseSelector` component (lines 266-307) with:

```tsx
function CaseSelector({
  cases,
  activeCase,
  onSelect
}: {
  cases: CaseInfo[]
  activeCase: { id: string; name: string } | null
  onSelect: (id: string) => void
}) {
  if (cases.length === 0) {
    return (
      <section className="animate-fade-up rounded-2xl p-4 bg-d-card border border-d-border dark-card-glow text-center">
        <p className="text-xs text-d-text-muted mb-1">No cases yet</p>
        <p className="text-[10px] text-d-text-muted">Create one in the Birdbrain app.</p>
      </section>
    )
  }

  return (
    <section className="animate-fade-up">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-d-text-muted mb-2">
        Active Case
      </h4>
      <select
        value={activeCase?.id ?? ''}
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value)
        }}
        className="w-full rounded-xl px-3 py-2.5 text-xs font-medium bg-d-card border border-d-border text-white appearance-none cursor-pointer hover:bg-white/[0.04] transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {!activeCase && (
          <option value="" disabled>
            Select a case...
          </option>
        )}
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.captureCount})
          </option>
        ))}
      </select>
    </section>
  )
}
```

- [ ] **Step 2: Always render `CaseSelector` in the popup**

In `extension/src/popup/popup.tsx`, replace the `<main>` section in the connected return (lines 457-469) with:

```tsx
      <main className="p-4 space-y-3.5">
        <CaseSelector cases={cases} activeCase={activeCase} onSelect={handleActivateCase} />

        {activeCase && (
          <StatusCard
            sessionActive={sessionActive}
            activeCase={activeCase}
            currentDomain={currentDomain}
          />
        )}

        <StatsGrid captureCount={captureCount} selectorCount={activeSelectorCount} />
      </main>
```

- [ ] **Step 3: Build extension to verify no compile errors**

Run: `pnpm build:extension`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat: always show case picker dropdown in extension popup"
```

---

### Task 7: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `pnpm test`

Expected: ALL PASS

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: No errors

- [ ] **Step 3: Build the full app**

Run: `pnpm build`

Expected: Build succeeds

- [ ] **Step 4: Build extension**

Run: `pnpm build:extension`

Expected: Build succeeds

- [ ] **Step 5: Commit any lint/type fixes if needed**

Only if Steps 1-4 revealed issues:

```bash
git add -u
git commit -m "fix: resolve lint/type issues from selector scoping changes"
```
