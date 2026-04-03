# Selector from Highlighted Text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to right-click highlighted text in the browser and create a literal selector in the active case via the Chrome extension.

**Architecture:** The extension adds a second context menu item (`contexts: ['selection']`) that POSTs to a new `POST /api/selectors` endpoint on the Hono capture server. The server creates the selector in SQLite and schedules retroactive matching asynchronously. The extension shows a toast confirming creation.

**Tech Stack:** Hono (server route), Chrome Extension APIs (contextMenus, tabs.sendMessage), better-sqlite3 (selector storage + matching), Vitest (tests)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tests/main/services/captureServer.test.ts` | Modify | Add tests for `POST /api/selectors` |
| `src/main/services/captureServer.ts` | Modify | Add `POST /api/selectors` route |
| `extension/src/utils/api.ts` | Modify | Add `createSelector()` function |
| `extension/src/background.ts` | Modify | Add context menu item + click handler |

No new files.

---

### Task 1: Write failing tests for POST /api/selectors

**Files:**
- Modify: `tests/main/services/captureServer.test.ts`

These tests follow the same patterns as the existing capture endpoint tests in this file. They use the same `beforeEach`/`afterEach` setup that creates an in-memory DB, temp storage, and a Hono server on an incrementing port.

- [ ] **Step 1: Add selector imports to the test file**

At line 5, the test file imports from `@main/services/database`. Add `createSelector`, `listSelectors`, and `getSelectorMatchCounts` to the existing import:

```typescript
import {
  initDatabase,
  closeDatabase,
  createCase,
  updateCase,
  listCaptures,
  createSelector,
  listSelectors,
  getSelectorMatchCounts
} from '@main/services/database'
```

Also add `readCaptureFile` from storage — update the storage import at line 6:

```typescript
import { initStorage, readCaptureFile } from '@main/services/storage'
```

- [ ] **Step 2: Write tests for POST /api/selectors**

Add the following test block after the existing manual dedup tests (after the `manual dedup state is cleared by resetSessionState` test, around line 751), but still inside the outer `describe('captureServer', ...)`:

```typescript
  // --- POST /api/selectors (create selector from extension) ---

  async function activateSessionForCase(caseId: string) {
    await fetch(`${baseUrl}/api/cases/${caseId}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })
  }

  it('POST /api/selectors creates a literal selector', async () => {
    const testCase = createCase({ name: 'Selector Create Test' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'suspicious transaction',
        label: 'from example.com'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data.selector).toBeDefined()
    expect(data.selector.pattern).toBe('suspicious transaction')
    expect(data.selector.isRegex).toBe(false)
    expect(data.selector.enabled).toBe(true)
    expect(data.selector.label).toBe('from example.com')
    expect(data.selector.caseId).toBe(testCase.id)
    expect(data.selector.id).toBeDefined()
    expect(data.selector.createdAt).toBeDefined()

    // Verify it persisted in the database
    const selectors = listSelectors(testCase.id)
    expect(selectors).toHaveLength(1)
    expect(selectors[0].pattern).toBe('suspicious transaction')
  })

  it('POST /api/selectors returns 400 without active session', async () => {
    const testCase = createCase({ name: 'No Session Selector' })

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('session')
  })

  it('POST /api/selectors returns 400 for empty pattern', async () => {
    const testCase = createCase({ name: 'Empty Pattern' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: ''
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('pattern')
  })

  it('POST /api/selectors returns 400 for missing pattern', async () => {
    const testCase = createCase({ name: 'Missing Pattern' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id
      })
    })

    expect(res.status).toBe(400)
  })

  it('POST /api/selectors returns 400 for missing caseId', async () => {
    const testCase = createCase({ name: 'Missing CaseId' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern: 'test'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('caseId')
  })

  it('POST /api/selectors returns 404 for unknown case', async () => {
    const testCase = createCase({ name: 'Unknown Case Selector' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: 'nonexistent-case-id',
        pattern: 'test'
      })
    })

    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('Case not found')
  })

  it('POST /api/selectors schedules retroactive matching', async () => {
    const testCase = createCase({ name: 'Retro Match Test' })
    await activateSessionForCase(testCase.id)

    // Create a capture with text content that contains the pattern
    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/page1',
        title: 'Page 1',
        html: '<html><body>suspicious transaction detected here</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'suspicious transaction detected here'
      })
    })

    // Create another capture without the pattern
    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/page2',
        title: 'Page 2',
        html: '<html><body>nothing interesting</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'nothing interesting'
      })
    })

    // Now create a selector that matches the first capture
    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'suspicious transaction'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()

    // Wait for setImmediate to complete retroactive matching
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Check that the selector matched the first capture
    const matchCounts = getSelectorMatchCounts(testCase.id)
    expect(matchCounts[data.selector.id]).toBe(1)
  })

  it('POST /api/selectors creates selector without label', async () => {
    const testCase = createCase({ name: 'No Label' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.selector.label).toBeNull()
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/captureServer.test.ts`

Expected: All new `POST /api/selectors` tests fail with 404 (route doesn't exist yet). Existing tests should still pass.

- [ ] **Step 4: Commit**

```bash
git add tests/main/services/captureServer.test.ts
git commit -m "test: add failing tests for POST /api/selectors endpoint"
```

---

### Task 2: Implement POST /api/selectors route

**Files:**
- Modify: `src/main/services/captureServer.ts`

- [ ] **Step 1: Add readCaptureFile import**

At line 8 in `captureServer.ts`, add `readCaptureFile` to the storage import:

```typescript
import { saveCapture, deleteCaptureFiles, readCaptureFile } from '@main/services/storage'
```

- [ ] **Step 2: Add the POST /api/selectors route**

In the `createApp()` function, add the new route after the existing `GET /api/selectors/active` route (after line 369) and before the test pipeline endpoint:

```typescript
  // Create a selector from the extension (highlighted text)
  app.post('/api/selectors', async (c) => {
    try {
      const body = await c.req.json()
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return c.json({ error: 'Invalid request body: expected JSON object' }, 400)
      }

      const { caseId, pattern, label } = body as {
        caseId?: string
        pattern?: string
        label?: string
      }

      // Validation
      if (!state.sessionActive) {
        return c.json({ error: 'No active session' }, 400)
      }
      if (!caseId) {
        return c.json({ error: 'Missing required field: caseId' }, 400)
      }
      if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        return c.json({ error: 'Missing or empty required field: pattern' }, 400)
      }

      const caseData = db.getCase(caseId)
      if (!caseData) {
        return c.json({ error: 'Case not found' }, 404)
      }

      const selector = db.createSelector({
        caseId,
        pattern: pattern.trim(),
        isRegex: false,
        label: label || undefined
      })

      // Schedule retroactive matching asynchronously
      setImmediate(() => {
        try {
          const captures = db.listCaptures(caseId)
          const captureTexts: Array<{ captureId: string; text: string }> = []
          for (const cap of captures) {
            const buffer = readCaptureFile(caseId, cap.id, 'txt')
            if (buffer) {
              captureTexts.push({ captureId: cap.id, text: buffer.toString('utf-8') })
            }
          }
          if (captureTexts.length > 0) {
            db.matchSelectorAgainstCaptures(selector.id, captureTexts)
          }
        } catch (err) {
          console.error('Retroactive selector matching error:', err)
        }
      })

      return c.json({ selector, status: 'ok' })
    } catch (err) {
      console.error('Create selector error:', err)
      return c.json({ error: 'Failed to create selector' }, 500)
    }
  })
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/captureServer.test.ts`

Expected: All tests pass, including the new `POST /api/selectors` tests.

- [ ] **Step 4: Run lint and format**

Run: `pnpm lint && pnpm format`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/captureServer.ts tests/main/services/captureServer.test.ts
git commit -m "feat: add POST /api/selectors endpoint for creating selectors from extension"
```

---

### Task 3: Add createSelector to extension API client

**Files:**
- Modify: `extension/src/utils/api.ts`

- [ ] **Step 1: Add CreateSelectorResult interface and createSelector function**

Add the interface after the existing `ActiveCaseSelectors` interface (around line 50), and the function after the existing `getActiveSelectors` function (around line 132):

After the `ActiveCaseSelectors` interface, add:

```typescript
interface CreateSelectorResult {
  selector: SelectorInfo
  status: string
}
```

After the `getActiveSelectors` function, add:

```typescript
export async function createSelector(params: {
  caseId: string
  pattern: string
  label?: string
}): Promise<CreateSelectorResult> {
  return request('/api/selectors', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}
```

- [ ] **Step 2: Run lint and format on extension**

Run: `pnpm lint && pnpm format`

Expected: No errors.

- [ ] **Step 3: Build extension to verify compilation**

Run: `pnpm build:extension`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add extension/src/utils/api.ts
git commit -m "feat: add createSelector API method to extension client"
```

---

### Task 4: Add context menu item and handler to background script

**Files:**
- Modify: `extension/src/background.ts`

- [ ] **Step 1: Add createSelector import and constant**

At line 1, add `createSelector` to the import:

```typescript
import { checkConnection, getStatus, sendCapture, getActiveSelectors, createSelector } from '@extension/utils/api'
```

After the existing `CONTEXT_MENU_ID` constant (line 17), add:

```typescript
const SELECTOR_CONTEXT_MENU_ID = 'birdbrain-create-selector'
```

- [ ] **Step 2: Register the context menu item**

In the `chrome.runtime.onInstalled.addListener` callback (around line 109), after the existing `chrome.contextMenus.create` call, add the second menu item:

```typescript
  chrome.contextMenus.create({
    id: SELECTOR_CONTEXT_MENU_ID,
    title: 'Create Selector from Selection',
    contexts: ['selection'],
    enabled: false
  })
```

- [ ] **Step 3: Add the click handler**

In the `chrome.contextMenus.onClicked.addListener` callback (line 118), add handling for the new menu item. Replace the existing listener with one that handles both menu items:

```typescript
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === SELECTOR_CONTEXT_MENU_ID) {
    if (!tab?.id || !tab.url) return
    if (!connected || !sessionActive) return
    if (!activeCaseId) return

    const selectedText = info.selectionText?.trim()
    if (!selectedText) return

    // Derive label from page hostname
    let label: string | undefined
    try {
      label = `from ${new URL(tab.url).hostname}`
    } catch {
      // Invalid URL, skip label
    }

    // Show "creating" toast
    chrome.tabs
      .sendMessage(tab.id, {
        type: 'SHOW_CAPTURE_TOAST',
        status: 'capturing',
        message: 'Creating selector...'
      })
      .catch(() => {})

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
    } catch (err) {
      console.error('[Birdbrain] Create selector failed:', err)

      let message = 'Failed to create selector'
      if (err && typeof err === 'object' && 'status' in err) {
        const apiErr = err as { status: number; detail: string }
        if (apiErr.status === 400) message = `Selector rejected: ${apiErr.detail}`
        else if (apiErr.status === 404) message = 'Case not found'
      } else if (err instanceof TypeError) {
        message = "Can't reach Birdbrain — is it running?"
      }

      chrome.tabs
        .sendMessage(tab.id, {
          type: 'UPDATE_CAPTURE_TOAST',
          status: 'error',
          message
        })
        .catch(() => {})
    }
    return
  }

  if (info.menuItemId !== CONTEXT_MENU_ID) return
  if (!tab?.id || !tab.url) return
  if (!connected) return
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(tab.url!))) return
  if (isIgnoredByUser(tab.url!)) return

  const targetCaseId = activeCaseId
  if (!targetCaseId) {
    console.warn('[Birdbrain] Manual capture skipped: no active case')
    return
  }

  manualCaptureTab(tab.id, tab.url, targetCaseId)
})
```

- [ ] **Step 4: Update the context menu enabled state in checkStatus**

In the `checkStatus()` function, after the existing `chrome.contextMenus.update` call (around line 82), add the same update for the selector menu item:

```typescript
    chrome.contextMenus
      .update(SELECTOR_CONTEXT_MENU_ID, {
        enabled: connected && sessionActive && !!activeCaseId
      })
      .catch(() => {
        // Menu may not exist yet
      })
```

- [ ] **Step 5: Run lint and format**

Run: `pnpm lint && pnpm format`

Expected: No errors.

- [ ] **Step 6: Build extension to verify compilation**

Run: `pnpm build:extension`

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: add 'Create Selector from Selection' context menu to extension"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`

Expected: All tests pass.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: No errors.

- [ ] **Step 3: Build the full app**

Run: `pnpm build`

Expected: Build succeeds.

- [ ] **Step 4: Build the extension**

Run: `pnpm build:extension`

Expected: Build succeeds.

---

## Manual Testing Checklist

After implementation, verify the feature end-to-end:

1. Start the Electron app with `pnpm dev`
2. Create a case and start a session
3. Load the Chrome extension (unpacked from `extension/dist/`)
4. Navigate to any web page
5. Highlight text on the page
6. Right-click → "Create Selector from Selection" should appear
7. Click it → toast should show "Creating selector..." then "Selector created"
8. In the Electron app, navigate to the case's selectors view
9. The new selector should appear with the highlighted text as the pattern
10. The label should show "from <hostname>"
11. If captures existed with matching text, they should show in the match count
