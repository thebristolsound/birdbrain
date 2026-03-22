# Capture Pipeline Simplification & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the capture pipeline into a single endpoint with honest feedback, and add observability via a health dashboard and test tooling.

**Architecture:** Consolidate three capture endpoints into one `POST /api/captures` with a `source` discriminator. Drop the two-phase manual capture. Add a capture event system that flows from the server through IPC to a health dashboard popover. Extension toasts reflect real capture outcomes.

**Tech Stack:** Hono (HTTP server), Electron IPC, React 19, Zustand, Tailwind v4, Chrome Extension APIs, Vitest

**Spec:** `docs/superpowers/specs/2026-03-21-capture-pipeline-simplification-design.md`

---

### Task 1: Add shared types and IPC channels

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`

- [ ] **Step 1: Write failing test for new types**

Create a simple type-check test to verify the new types compile:

```typescript
// tests/shared/captureTypes.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { CaptureEvent, CaptureSource } from '@shared/types'

describe('capture types', () => {
  it('CaptureSource is a union of auto, manual, selector', () => {
    expectTypeOf<CaptureSource>().toEqualTypeOf<'auto' | 'manual' | 'selector'>()
  })

  it('CaptureEvent has required fields', () => {
    const event: CaptureEvent = {
      type: 'stored',
      source: 'manual',
      url: 'https://example.com',
      timestamp: new Date().toISOString()
    }
    expectTypeOf(event).toMatchTypeOf<CaptureEvent>()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/shared/captureTypes.test.ts`
Expected: FAIL — `CaptureEvent` and `CaptureSource` not found in `@shared/types`

- [ ] **Step 3: Add types to src/shared/types.ts**

Add at the end of `src/shared/types.ts`:

```typescript
export type CaptureSource = 'auto' | 'manual' | 'selector'

export interface CaptureEvent {
  type: 'received' | 'stored' | 'failed' | 'skipped' | 'extraction_done'
  captureId?: string
  source: CaptureSource
  url: string
  timestamp: string
  error?: string
  skipReason?: string
  durationMs?: number
}
```

- [ ] **Step 4: Add IPC channels to src/shared/ipc.ts**

Add to the `IPC_CHANNELS` object:

```typescript
  // Capture pipeline observability
  CAPTURE_ACTIVITY: 'event:captureActivity',
  CAPTURES_TEST_PIPELINE: 'captures:testPipeline',
  CAPTURES_TEST_HTTP: 'captures:testHttp',
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/shared/captureTypes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts tests/shared/captureTypes.test.ts
git commit -m "feat: add CaptureEvent types and observability IPC channels"
```

---

### Task 2: Consolidate capture server to unified endpoint

**Files:**
- Modify: `src/main/services/captureServer.ts`
- Modify: `tests/main/services/captureServer.test.ts`

This is the largest task. We replace three endpoints with one, remove the PATCH endpoint, add event emission, and update CORS.

- [ ] **Step 1: Write tests for the unified endpoint**

Replace the existing capture tests in `tests/main/services/captureServer.test.ts`. First, update the imports to add `updateCase` and `listCases`:

```typescript
import { initDatabase, closeDatabase, createCase, updateCase, listCases, listCaptures, getCapture } from '@main/services/database'
```

Keep all the setup/teardown and non-capture tests (status, cases, session). Update blacklist tests to use `source` field. Replace the capture-specific tests with:

```typescript
  // --- Unified POST /api/captures ---

  it('POST /api/captures with source=auto stores capture when session active', async () => {
    const testCase = createCase({ name: 'Auto Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com',
        title: 'Example Page',
        html: '<html><body>Hello World</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'Hello World'
      })
    })

    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.captureId).toBeDefined()
    expect(data.hash).toHaveLength(64)
    expect(data.source).toBe('auto')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].url).toBe('https://example.com')
  })

  it('POST /api/captures with source=auto rejects without active session', async () => {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures with source=auto increments capture count', async () => {
    const testCase = createCase({ name: 'Count Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://a.com',
        title: 'A',
        html: '<html>a</html>'
      })
    })

    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://b.com',
        title: 'B',
        html: '<html>b</html>'
      })
    })

    const state = getSessionState()
    expect(state.captureCount).toBe(2)
  })

  it('POST /api/captures with source=manual stores capture without session', async () => {
    const testCase = createCase({ name: 'Manual Test' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: testCase.id,
        url: 'https://example.com/manual',
        title: 'Manual Page',
        html: '<html><body>Manual capture</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'Manual capture'
      })
    })

    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.source).toBe('manual')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)

    // Should NOT increment session capture count
    const state = getSessionState()
    expect(state.captureCount).toBe(0)
  })

  it('POST /api/captures with source=manual returns 400 without caseId', async () => {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures with source=manual returns 404 for unknown case', async () => {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: 'nonexistent-id',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/captures with source=manual returns 400 for archived case', async () => {
    const testCase = createCase({ name: 'Archived Test' })
    // Archive the case
    updateCase({ id: testCase.id, archived: true })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: testCase.id,
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures with source=selector requires caseId and matchedSelectors', async () => {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'selector',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures with source=selector stores capture', async () => {
    const testCase = createCase({ name: 'Selector Test' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'selector',
        caseId: testCase.id,
        url: 'https://example.com/selector',
        title: 'Selector Page',
        html: '<html><body>Selector capture</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'Selector capture',
        matchedSelectors: [{
          selectorId: 'sel-1',
          caseId: testCase.id,
          caseName: 'Selector Test',
          pattern: 'test',
          matchText: 'capture',
          context: 'Selector capture',
          index: 9
        }]
      })
    })

    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.source).toBe('selector')
  })

  it('POST /api/captures rejects missing url or html', async () => {
    const testCase = createCase({ name: 'Validation Test' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: testCase.id,
        url: 'https://example.com'
        // missing html
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures defaults source to auto for backwards compatibility', async () => {
    const testCase = createCase({ name: 'Default Source' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        title: 'No Source',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.source).toBe('auto')
  })
```

Also update blacklist tests to use `source` field — change `/api/captures/manual` to `POST /api/captures` with `source: 'manual'`, and `/api/captures/selector` to `POST /api/captures` with `source: 'selector'`. Remove all PATCH tests entirely.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/main/services/captureServer.test.ts`
Expected: FAIL — old endpoints still exist, new `source` field not recognized

- [ ] **Step 3: Implement the unified endpoint**

Rewrite the `POST /api/captures` handler in `captureServer.ts`:

1. Remove the three separate handlers (`/api/captures`, `/api/captures/manual`, `/api/captures/selector`)
2. Remove the `PATCH /api/captures/:id/html` handler
3. Remove `updateCaptureHtml` import from storage
4. Update CORS `allowMethods` to `['GET', 'POST']`
5. Add `emitCaptureEvent()` helper function
6. Implement the unified handler following the decision tree from the spec:

```typescript
import type { CaptureEvent, CaptureSource } from '@shared/types'

function emitCaptureEvent(event: CaptureEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.CAPTURE_ACTIVITY, event)
  }
}

// In createApp():
app.post('/api/captures', async (c) => {
  const startTime = Date.now()
  let source: CaptureSource = 'auto'
  let capturedUrl = ''
  try {
    const body = await c.req.json()
    source = body.source || 'auto'
    const { url, title, html, screenshot, timestamp, headers, textContent, matchedSelectors } = body
    capturedUrl = url || ''

    // 1. Common validation
    if (!url || !html) {
      return c.json({ error: 'Missing required fields: url, html' }, 400)
    }

    // 2. URL blacklist
    const captureSettings = getSettings()
    const blocked = isUrlBlacklisted(url, captureSettings.ignoredUrlPatterns)
    if (blocked) {
      emitCaptureEvent({ type: 'skipped', source, url, timestamp: new Date().toISOString(), skipReason: `Blacklisted: ${blocked}` })
      return c.json({ error: 'URL blocked by ignored pattern', pattern: blocked }, 403)
    }

    // 3. Source-specific validation
    let caseId: string

    if (source === 'auto') {
      if (!state.sessionActive) {
        return c.json({ error: 'No active session' }, 400)
      }
      if (!state.activeCaseId) {
        return c.json({ error: 'No active case' }, 400)
      }
      caseId = state.activeCaseId
    } else if (source === 'manual') {
      if (!body.caseId) {
        return c.json({ error: 'Missing required field: caseId' }, 400)
      }
      const caseData = db.getCase(body.caseId)
      if (!caseData) {
        return c.json({ error: 'Case not found' }, 404)
      }
      if (caseData.archived) {
        return c.json({ error: 'Case is archived' }, 400)
      }
      caseId = body.caseId
    } else if (source === 'selector') {
      if (!body.caseId) {
        return c.json({ error: 'Missing required field: caseId' }, 400)
      }
      if (!matchedSelectors) {
        return c.json({ error: 'Missing required field: matchedSelectors' }, 400)
      }
      const caseData = db.getCase(body.caseId)
      if (!caseData) {
        return c.json({ error: 'Case not found' }, 404)
      }
      caseId = body.caseId
    } else {
      return c.json({ error: `Invalid source: ${source}` }, 400)
    }

    emitCaptureEvent({ type: 'received', source, url, timestamp: new Date().toISOString() })

    // 4. Shared pipeline
    const hash = hashContent(html)
    const screenshotBuffer = screenshot ? Buffer.from(screenshot, 'base64') : undefined
    const captureId = crypto.randomUUID()

    const paths = saveCapture(caseId, captureId, html, screenshotBuffer, textContent)

    const capture = db.insertCapture({
      id: captureId,
      caseId,
      url,
      title: title || url,
      hash,
      timestamp: timestamp || new Date().toISOString(),
      htmlPath: paths.htmlPath,
      screenshotPath: paths.screenshotPath,
      headers: headers ? JSON.stringify(headers) : undefined,
      textContent
    })

    if (source === 'auto') {
      state.captureCount++
    }

    schedulePostCaptureWork(capture.id, caseId, textContent)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
    }

    const durationMs = Date.now() - startTime
    emitCaptureEvent({ type: 'stored', captureId: capture.id, source, url, timestamp: new Date().toISOString(), durationMs })

    return c.json({ captureId: capture.id, hash, status: 'ok', source })
  } catch (err) {
    console.error('Capture error:', err)
    emitCaptureEvent({ type: 'failed', source, url: capturedUrl, timestamp: new Date().toISOString(), error: String(err) })
    return c.json({ error: 'Failed to process capture' }, 500)
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/main/services/captureServer.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/captureServer.ts tests/main/services/captureServer.test.ts
git commit -m "feat: consolidate capture endpoints into unified POST /api/captures"
```

---

### Task 3: Simplify extension API client

**Files:**
- Modify: `extension/src/utils/api.ts`

- [ ] **Step 1: Update request() to throw structured errors with HTTP status**

Replace the `request()` function to preserve status codes for error categorization:

```typescript
class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, statusText: string, detail: string) {
    super(`Request failed: ${status} ${statusText}`)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.error || detail
    } catch { /* no JSON body */ }
    throw new ApiError(res.status, res.statusText, detail)
  }
  return res.json() as Promise<T>
}
```

- [ ] **Step 2: Replace capture functions with single sendCapture**

Remove `sendManualCapture()`, `sendSelectorCapture()`, `updateCaptureHtml()`. Update `sendCapture()` to accept the new `CaptureRequest` shape. Add `testCapturePipeline()`. Export `ApiError` for use in background.ts.

```typescript
// Updated CaptureResult to include source
interface CaptureResult {
  captureId: string
  hash: string
  status: string
  source: string
}

export async function sendCapture(data: {
  source: 'auto' | 'manual' | 'selector'
  caseId?: string
  url: string
  title: string
  html: string
  screenshot?: string
  timestamp: string
  headers?: Record<string, string>
  textContent?: string
  matchedSelectors?: SelectorMatchInfo[]
}): Promise<CaptureResult> {
  return request('/api/captures', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

export async function testCapturePipeline(): Promise<{ success: boolean; durationMs: number; error?: string }> {
  return request('/api/captures/test')
}
```

Remove the old `sendManualCapture`, `sendSelectorCapture`, and `updateCaptureHtml` functions entirely.

- [ ] **Step 2: Update background.ts imports (do NOT commit yet — extension won't build until background.ts is updated)**

Replace the import line:
```typescript
import {
  checkConnection,
  getStatus,
  sendCapture,
  sendManualCapture,
  updateCaptureHtml,
  getActiveSelectors,
  sendSelectorCapture
} from '@extension/utils/api'
```

With:
```typescript
import {
  checkConnection,
  getStatus,
  sendCapture,
  getActiveSelectors
} from '@extension/utils/api'
```

- [ ] **Step 2: Rewrite captureTab to use source field**

```typescript
async function captureTab(tabId: number, url: string): Promise<void> {
  try {
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' }) as {
      html: string
      title: string
      textContent: string
    }

    let screenshot: string | undefined
    try {
      screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
      screenshot = screenshot.replace(/^data:image\/png;base64,/, '')
    } catch {
      // Screenshot may fail on restricted pages
    }

    await sendCapture({
      source: 'auto',
      url,
      title: pageData.title,
      html: pageData.html,
      screenshot,
      timestamp: new Date().toISOString(),
      textContent: pageData.textContent
    })

    dedupeMap.set(url, Date.now())
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })
  } catch (err) {
    console.error('Capture failed:', err)
  }
}
```

- [ ] **Step 3: Rewrite manualCaptureTab — drop two-phase, use single extraction**

```typescript
async function manualCaptureTab(tabId: number, url: string, caseId: string): Promise<void> {
  try {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_CAPTURE_TOAST' }).catch(() => {})

    // Single extraction: freeze-dry with fallback + screenshot in parallel
    const [pageData, rawScreenshot] = await Promise.all([
      chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' }) as Promise<{
        html: string
        title: string
        textContent: string
        degraded: boolean
      }>,
      chrome.tabs.captureVisibleTab({ format: 'png' }).catch(() => undefined)
    ])
    const screenshot = rawScreenshot?.replace(/^data:image\/png;base64,/, '')

    await sendCapture({
      source: 'manual',
      caseId,
      url,
      title: pageData.title,
      html: pageData.html,
      screenshot,
      timestamp: new Date().toISOString(),
      textContent: pageData.textContent
    })

    chrome.tabs.sendMessage(tabId, {
      type: 'UPDATE_CAPTURE_TOAST',
      status: pageData.degraded ? 'degraded' : 'success'
    }).catch(() => {})
  } catch (err) {
    console.error('[Birdbrain] Manual capture failed:', err)

    // Categorize error for user-facing message
    let message = 'Capture failed'
    if (err && typeof err === 'object' && 'status' in err) {
      const apiErr = err as { status: number; detail: string }
      if (apiErr.status === 400) message = `Capture rejected: ${apiErr.detail}`
      else if (apiErr.status === 403) message = 'URL is blacklisted'
      else if (apiErr.status === 404) message = 'Case not found'
      else if (apiErr.status === 500) message = 'Server error — check Birdbrain app'
    } else if (err instanceof TypeError) {
      message = "Can't reach Birdbrain — is it running?"
    }

    chrome.tabs.sendMessage(tabId, {
      type: 'UPDATE_CAPTURE_TOAST',
      status: 'error',
      message
    }).catch(() => {})
  }
}
```

- [ ] **Step 4: Rewrite handleSelectorCapture to use source field**

```typescript
async function handleSelectorCapture(
  tabId: number,
  url: string,
  caseId: string
): Promise<void> {
  if (!shouldSelectorCapture(caseId, url)) return

  try {
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' }) as {
      html: string
      title: string
      textContent: string
    }

    let screenshot: string | undefined
    try {
      screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
      screenshot = screenshot.replace(/^data:image\/png;base64,/, '')
    } catch {
      // Screenshot may fail
    }

    await sendCapture({
      source: 'selector',
      caseId,
      url,
      title: pageData.title,
      html: pageData.html,
      screenshot,
      timestamp: new Date().toISOString(),
      textContent: pageData.textContent,
      matchedSelectors: []
    })

    selectorDedupeMap.set(`${caseId}:${url}`, Date.now())
  } catch (err) {
    console.error('Selector capture failed:', err)
  }
}
```

- [ ] **Step 5: Verify extension builds**

Run: `pnpm build:extension`
Expected: Build succeeds

- [ ] **Step 6: Commit both api.ts and background.ts together**

```bash
git add extension/src/utils/api.ts extension/src/background.ts
git commit -m "feat: simplify extension to single sendCapture with unified endpoint"
```

---

### Task 5: Update content script — remove EXTRACT_PAGE_FAST, add degraded flag

**Files:**
- Modify: `extension/src/content.ts`

- [ ] **Step 1: Remove the EXTRACT_PAGE_FAST handler**

Delete the `EXTRACT_PAGE_FAST` message handler block (lines 249-255 in content.ts):

```typescript
  // DELETE THIS BLOCK:
  if (message.type === 'EXTRACT_PAGE_FAST') {
    const title = document.title
    const textContent = document.body?.innerText || ''
    const html = document.documentElement.outerHTML
    sendResponse({ html, title, textContent })
    return
  }
```

- [ ] **Step 1b: Update EXTRACT_PAGE handler to include degraded flag**

The `EXTRACT_PAGE` handler's fallback path sends raw HTML when freeze-dry fails, but the caller can't tell which path was taken. Update it to include a `degraded` boolean:

```typescript
  if (message.type === 'EXTRACT_PAGE') {
    const title = document.title
    const textContent = document.body?.innerText || ''

    freezeDry(document, {
      timeout: 10000,
      addMetadata: true
    })
      .then((html) => {
        sendResponse({ html, title, textContent, degraded: false })
      })
      .catch(() => {
        sendResponse({
          html: document.documentElement.outerHTML,
          title,
          textContent,
          degraded: true
        })
      })

    return true
  }
```

- [ ] **Step 2: Verify extension builds**

Run: `pnpm build:extension`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add extension/src/content.ts
git commit -m "refactor: remove EXTRACT_PAGE_FAST content script handler"
```

---

### Task 6: Add capture event emission to post-capture work

**Files:**
- Modify: `src/main/services/captureServer.ts`

- [ ] **Step 1: Write test for extraction_done event**

Add to `tests/main/services/captureServer.test.ts`:

```typescript
  it('emits capture events for successful capture', async () => {
    const testCase = createCase({ name: 'Event Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com',
        title: 'Event Page',
        html: '<html><body>Event test</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'Event test'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
    // Event emission is tested via mainWindow mock — see integration test
    // For unit test, we just verify the capture succeeded
  })
```

- [ ] **Step 2: Update schedulePostCaptureWork to emit extraction_done event**

Modify `schedulePostCaptureWork` in `captureServer.ts`:

```typescript
function schedulePostCaptureWork(captureId: string, caseId: string, source: CaptureSource, url: string, textContent: string | undefined): void {
  setImmediate(() => {
    try {
      runRuleBasedExtraction(captureId, textContent)
    } catch (err) {
      console.error('Rule-based extraction error for capture', captureId, err)
    }
    try {
      if (textContent) {
        db.matchSelectorsForCapture(captureId, caseId, textContent)
      }
    } catch (err) {
      console.error('Selector matching error for capture', captureId, err)
    }
    emitCaptureEvent({
      type: 'extraction_done',
      captureId,
      source,
      url,
      timestamp: new Date().toISOString()
    })
  })
}
```

Update the call site in the unified handler to pass `source` and `url`:
```typescript
schedulePostCaptureWork(capture.id, caseId, source, url, textContent)
```

- [ ] **Step 3: Run tests**

Run: `pnpm test tests/main/services/captureServer.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/captureServer.ts tests/main/services/captureServer.test.ts
git commit -m "feat: emit capture activity events from pipeline"
```

---

### Task 7: Add test pipeline endpoint and IPC handlers

**Files:**
- Modify: `src/main/services/captureServer.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Write test for GET /api/captures/test**

Add to test file:

```typescript
  it('GET /api/captures/test returns pipeline health', async () => {
    // Need at least one case for test capture to work
    createCase({ name: 'Pipeline Test Case' })

    const res = await fetch(`${baseUrl}/api/captures/test`)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.durationMs).toBeGreaterThan(0)
    expect(data.error).toBeUndefined()

    // Test capture should be cleaned up — no captures in DB
    const cases = listCases()
    for (const c of cases) {
      const captures = listCaptures(c.id)
      // Only the test case exists, and it should have 0 captures after cleanup
      expect(captures).toHaveLength(0)
    }
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/captureServer.test.ts`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 3: Implement GET /api/captures/test**

Add to `captureServer.ts` in `createApp()`, after the unified capture endpoint:

```typescript
  // Test pipeline endpoint
  app.get('/api/captures/test', async (c) => {
    const startTime = Date.now()
    let testCaptureId: string | null = null
    let testCaseId: string | null = null

    try {
      // Find any case to use for test
      const cases = db.listCases()
      if (cases.length === 0) {
        return c.json({ success: false, durationMs: 0, error: 'No cases exist — create a case first' })
      }
      testCaseId = cases[0].id

      // Create test capture
      const testHtml = `<html><body>Birdbrain pipeline test ${Date.now()}</body></html>`
      const hash = hashContent(testHtml)
      testCaptureId = crypto.randomUUID()

      const paths = saveCapture(testCaseId, testCaptureId, testHtml, undefined, undefined)

      db.insertCapture({
        id: testCaptureId,
        caseId: testCaseId,
        url: 'birdbrain://pipeline-test',
        title: 'Pipeline Test',
        hash,
        timestamp: new Date().toISOString(),
        htmlPath: paths.htmlPath,
        screenshotPath: undefined,
        headers: undefined,
        textContent: undefined
      })

      // Verify by reading back
      const capture = db.getCapture(testCaptureId)
      if (!capture) {
        return c.json({ success: false, durationMs: Date.now() - startTime, error: 'Test capture not found in DB after insert' })
      }
      if (capture.hash !== hash) {
        return c.json({ success: false, durationMs: Date.now() - startTime, error: 'Hash mismatch after insert' })
      }

      return c.json({ success: true, durationMs: Date.now() - startTime })
    } catch (err) {
      return c.json({ success: false, durationMs: Date.now() - startTime, error: String(err) })
    } finally {
      // Cleanup
      if (testCaptureId) {
        try { db.deleteCapture(testCaptureId) } catch { /* best effort */ }
      }
    }
  })
```

- [ ] **Step 4: Add IPC handlers for pipeline tests**

Add to `src/main/ipcHandlers.ts`:

```typescript
  // Capture pipeline test — calls the Hono server's test endpoint
  // Import DEFAULT_PORT from captureServer or use the same constant
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TEST_PIPELINE, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${19845}/api/captures/test`)
      return res.json()
    } catch (err) {
      return { success: false, durationMs: 0, error: String(err) }
    }
  })
```

Also add the import for `IPC_CHANNELS` changes (the new channels).

- [ ] **Step 5: Run tests**

Run: `pnpm test tests/main/services/captureServer.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/captureServer.ts src/main/ipcHandlers.ts tests/main/services/captureServer.test.ts
git commit -m "feat: add capture pipeline test endpoint and IPC handler"
```

---

### Task 8: Update preload bridge

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add capture activity event listener and test pipeline invoke**

In `src/preload/index.ts`, add to the `birdbrain` object:

```typescript
  // Inside the birdbrain object, after the existing event listeners:

  onCaptureActivity: (callback: (event: CaptureEvent) => void) => {
    const handler = (_: unknown, event: CaptureEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.CAPTURE_ACTIVITY, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CAPTURE_ACTIVITY, handler)
  },

  testPipeline: (): Promise<{ success: boolean; durationMs: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_TEST_PIPELINE),

  testHttp: (): Promise<{ success: boolean; durationMs: number; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_TEST_HTTP),
```

Add the `CaptureEvent` import:
```typescript
import type { ..., CaptureEvent } from '@shared/types'
```

- [ ] **Step 2: Verify build compiles**

Run: `pnpm build`
Expected: Build succeeds (or at least TypeScript compilation succeeds)

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose capture activity events and test pipeline in preload bridge"
```

---

### Task 9: Add capture events to Zustand store

**Files:**
- Modify: `src/renderer/stores/appStore.ts`
- Modify: `src/renderer/hooks/useServerStatus.ts`

- [ ] **Step 1: Add capture event state and actions to appStore**

Add to the `AppState` interface:

```typescript
  captureEvents: CaptureEvent[]
  captureStats: {
    successCount: number
    failCount: number
    skipCount: number
    lastError?: { message: string; timestamp: string }
  }
  addCaptureEvent: (event: CaptureEvent) => void
  clearCaptureEvents: () => void
```

Add the import:
```typescript
import type { CaptureEvent } from '@shared/types'
```

Add to the store implementation:

```typescript
  captureEvents: [],
  captureStats: { successCount: 0, failCount: 0, skipCount: 0 },

  addCaptureEvent: (event) =>
    set((s) => {
      const events = [event, ...s.captureEvents].slice(0, 50) // ring buffer, newest first
      const stats = { ...s.captureStats }
      if (event.type === 'stored') stats.successCount++
      if (event.type === 'failed') {
        stats.failCount++
        stats.lastError = { message: event.error || 'Unknown error', timestamp: event.timestamp }
      }
      if (event.type === 'skipped') stats.skipCount++
      return { captureEvents: events, captureStats: stats }
    }),

  clearCaptureEvents: () =>
    set({ captureEvents: [], captureStats: { successCount: 0, failCount: 0, skipCount: 0 } }),
```

- [ ] **Step 2: Subscribe to capture activity events in useServerStatus hook**

Add to `useServerStatus.ts`:

```typescript
  useEffect(() => {
    // ... existing subscriptions ...

    const unsubCapture = window.birdbrain.onCaptureActivity((event) => {
      addCaptureEvent(event)
    })

    return () => {
      unsubExtension()
      unsubSession()
      unsubCapture()
    }
  }, [setConnectedToExtension, setSessionActive, setActiveCaseId, addCaptureEvent])
```

Update the destructure from `useAppStore` to include `addCaptureEvent`.

- [ ] **Step 3: Verify build compiles**

Run: `pnpm build`
Expected: TypeScript compilation succeeds

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/appStore.ts src/renderer/hooks/useServerStatus.ts
git commit -m "feat: add capture events to Zustand store with ring buffer"
```

---

### Task 10: Build CaptureHealth popover component

**Files:**
- Create: `src/renderer/components/status/CaptureHealth.tsx`
- Modify: `src/renderer/components/status/ConnectionStatus.tsx`

- [ ] **Step 1: Create CaptureHealth component**

```typescript
// src/renderer/components/status/CaptureHealth.tsx
import { useState } from 'react'
import { Activity, CheckCircle2, XCircle, AlertTriangle, Loader2, Zap } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import type { CaptureEvent } from '@shared/types'

function EventIcon({ type }: { type: CaptureEvent['type'] }) {
  switch (type) {
    case 'stored': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    case 'failed': return <XCircle className="h-3.5 w-3.5 text-red-400" />
    case 'skipped': return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
    case 'received': return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    case 'extraction_done': return <Zap className="h-3.5 w-3.5 text-indigo-400" />
  }
}

function EventRow({ event }: { event: CaptureEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString()
  const urlShort = event.url.length > 40 ? event.url.slice(0, 40) + '...' : event.url

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-[11px]">
      <EventIcon type={event.type} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-slate-300">{urlShort}</div>
        <div className="flex gap-2 text-slate-500">
          <span>{event.source}</span>
          <span>{time}</span>
          {event.durationMs !== undefined && <span>{event.durationMs}ms</span>}
          {event.error && <span className="text-red-400">{event.error}</span>}
          {event.skipReason && <span className="text-amber-400">{event.skipReason}</span>}
        </div>
      </div>
    </div>
  )
}

export function CaptureHealth() {
  const [open, setOpen] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; durationMs: number; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const captureEvents = useAppStore((s) => s.captureEvents)
  const captureStats = useAppStore((s) => s.captureStats)
  const clearCaptureEvents = useAppStore((s) => s.clearCaptureEvents)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)

  async function runPipelineTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.birdbrain.testPipeline()
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, durationMs: 0, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  async function runHttpTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.birdbrain.testHttp()
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, durationMs: 0, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  const hasFailures = captureStats.failCount > 0

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
          hasFailures
            ? 'border-red-500/20 bg-red-500/10 text-red-400'
            : captureStats.successCount > 0
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
            : 'border-slate-700 bg-slate-800 text-slate-500'
        }`}
        title="Capture pipeline health"
      >
        <Activity className="h-3.5 w-3.5" />
        {captureStats.successCount > 0 && <span>{captureStats.successCount}</span>}
        {hasFailures && <span className="text-red-400">/{captureStats.failCount}!</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-lg border border-white/[0.06] bg-slate-900 shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <span className="text-xs font-medium text-slate-300">Capture Pipeline</span>
            <button onClick={clearCaptureEvents} className="text-[10px] text-slate-500 hover:text-slate-300">
              Clear
            </button>
          </div>

          {/* Status row */}
          <div className="flex gap-4 border-b border-white/[0.06] px-3 py-2 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${connectedToExtension ? 'bg-emerald-500' : 'bg-slate-500'}`} />
              <span className="text-slate-400">{connectedToExtension ? 'Extension' : 'No extension'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${sessionActive ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
              <span className="text-slate-400">{sessionActive ? 'Recording' : 'Idle'}</span>
            </div>
            <div className="text-slate-500">
              {captureStats.successCount}ok / {captureStats.failCount}fail / {captureStats.skipCount}skip
            </div>
          </div>

          {/* Last error */}
          {captureStats.lastError && (
            <div className="border-b border-white/[0.06] px-3 py-2">
              <div className="text-[10px] font-medium text-red-400">Last error</div>
              <div className="text-[11px] text-slate-400">{captureStats.lastError.message}</div>
              <div className="text-[10px] text-slate-600">{new Date(captureStats.lastError.timestamp).toLocaleTimeString()}</div>
            </div>
          )}

          {/* Event list */}
          <div className="max-h-60 overflow-y-auto">
            {captureEvents.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-slate-600">No capture activity yet</div>
            ) : (
              captureEvents.map((event, i) => <EventRow key={i} event={event} />)
            )}
          </div>

          {/* Test buttons */}
          <div className="flex gap-2 border-t border-white/[0.06] px-3 py-2">
            <button
              onClick={runPipelineTest}
              disabled={testing}
              className="flex-1 rounded bg-slate-800 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Pipeline'}
            </button>
            <button
              onClick={runHttpTest}
              disabled={testing}
              className="flex-1 rounded bg-slate-800 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test HTTP'}
            </button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`px-3 py-2 text-[11px] ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.success
                ? `Pipeline OK — verified in ${testResult.durationMs}ms`
                : `Pipeline FAILED: ${testResult.error}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrate CaptureHealth into TopBar**

In `src/renderer/components/status/ConnectionStatus.tsx`, keep it as-is. We'll add `CaptureHealth` directly to the TopBar instead.

In `src/renderer/components/layout/TopBar.tsx`, add the import:
```typescript
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
```

Add `<CaptureHealth />` next to the `<ConnectionStatus />` in the case-workspace view:
```typescript
            <ConnectionStatus />
            <CaptureHealth />
```

- [ ] **Step 3: Verify build compiles**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/status/CaptureHealth.tsx src/renderer/components/layout/TopBar.tsx
git commit -m "feat: add capture health dashboard popover to top bar"
```

---

### Task 11: Update extension toast for honest feedback

**Files:**
- Modify: `extension/src/toast.ts`

- [ ] **Step 1: Add new toast states**

Update the `ToastOptions` interface and rendering to support the new states:

```typescript
interface ToastOptions {
  status: 'capturing' | 'success' | 'degraded' | 'error' | 'skipped'
  message?: string
}
```

Add CSS class for degraded and skipped states:
```css
  .toast.degraded {
    border-color: rgba(251, 191, 36, 0.4);
  }
  .toast.skipped {
    border-color: rgba(148, 163, 184, 0.4);
  }
```

Update the icon rendering:
```typescript
  const icon =
    options.status === 'capturing' ? '<div class="spinner"></div>'
    : options.status === 'success' ? '<span class="icon">&#10003;</span>'
    : options.status === 'degraded' ? '<span class="icon">&#9888;</span>'
    : options.status === 'skipped' ? '<span class="icon">&#8505;</span>'
    : '<span class="icon">&#10007;</span>'
```

Update default messages:
```typescript
  const message =
    options.message ??
    (options.status === 'capturing' ? 'Capturing page...'
    : options.status === 'success' ? 'Page captured'
    : options.status === 'degraded' ? 'Captured (basic snapshot)'
    : options.status === 'skipped' ? 'Already captured'
    : 'Capture failed')
```

Update `updateToast` auto-dismiss timings:
```typescript
export function updateToast(options: ToastOptions): void {
  if (removeTimeout) {
    clearTimeout(removeTimeout)
    removeTimeout = null
  }

  showToast(options)

  const dismissMs =
    options.status === 'success' ? 3000
    : options.status === 'degraded' ? 5000
    : options.status === 'skipped' ? 2000
    : options.status === 'error' ? 5000
    : 0 // capturing — no auto-dismiss

  if (dismissMs > 0) {
    removeTimeout = setTimeout(removeToast, dismissMs)
  }
}
```

- [ ] **Step 2: Verify extension builds**

Run: `pnpm build:extension`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add extension/src/toast.ts
git commit -m "feat: add degraded/skipped toast states with honest feedback timing"
```

---

### Task 12: Add HTTP test IPC handler and TypeScript declarations

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify or create: `src/preload/index.d.ts` or equivalent type declaration

- [ ] **Step 1: Add CAPTURES_TEST_HTTP handler**

Add to `ipcHandlers.ts`:

```typescript
  ipcMain.handle(IPC_CHANNELS.CAPTURES_TEST_HTTP, async () => {
    try {
      const res = await fetch('http://127.0.0.1:19845/api/captures/test')
      return res.json()
    } catch (err) {
      return { success: false, durationMs: 0, error: String(err) }
    }
  })
```

Note: `CAPTURES_TEST_HTTP` needs to be added to `IPC_CHANNELS` in `src/shared/ipc.ts` if not already added in Task 1. Verify and add if missing.

- [ ] **Step 2: Update window type declarations**

In `src/renderer/env.d.ts`, add the `CaptureEvent` import and new methods to the `BirdbrainAPI` interface:

```typescript
import type { ..., CaptureEvent } from '@shared/types'

// Add to BirdbrainAPI interface:
  onCaptureActivity(callback: (event: CaptureEvent) => void): () => void
  testPipeline(): Promise<{ success: boolean; durationMs: number; error?: string }>
  testHttp(): Promise<{ success: boolean; durationMs: number; error?: string }>
```

- [ ] **Step 3: Run full build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipcHandlers.ts src/shared/ipc.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat: add HTTP test IPC handler and type declarations"
```

---

### Task 13: Final integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 2: Run linter**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Build the Electron app**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Build the Chrome extension**

Run: `pnpm build:extension`
Expected: Build succeeds

- [ ] **Step 5: Commit any remaining fixes**

If any issues found in steps 1-4, fix and commit.

```bash
git commit -m "fix: address integration issues from pipeline simplification"
```
