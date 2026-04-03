# Capture Performance Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual captures feel instant by deferring heavy processing and providing immediate browser feedback.

**Architecture:** Two-phase approach. Phase 1 (quick wins): defer entity extraction and selector matching on manual/selector capture endpoints, batch entity DB inserts. Phase 2: split the extension capture into a fast metadata+screenshot send followed by background freeze-dry, and add a toast notification overlay in the content script for capture feedback.

**Tech Stack:** TypeScript, Hono (capture server), Chrome Extension APIs, better-sqlite3, freeze-dry

---

## File Structure

### Phase 1 — Server-Side Quick Wins

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/services/captureServer.ts` | Modify | Defer `runRuleBasedExtraction` and `matchSelectorsForCapture` on manual + selector endpoints via `setImmediate()` |
| `src/main/services/captureServer.ts` | Modify | Batch entity inserts inside a single transaction |

### Phase 2 — Two-Phase Capture + Browser Feedback

| File | Action | Responsibility |
|------|--------|----------------|
| `extension/src/content.ts` | Modify | Add new `EXTRACT_PAGE_FAST` message handler (title + textContent + outerHTML), keep `EXTRACT_PAGE` for freeze-dry |
| `extension/src/content.ts` | Modify | Add `SHOW_CAPTURE_TOAST` / `UPDATE_CAPTURE_TOAST` message handlers for toast overlay |
| `extension/src/toast.ts` | Create | Toast notification UI (small overlay, Shadow DOM isolation) |
| `extension/src/background.ts` | Modify | Rewrite `manualCaptureTab` to two-phase: fast capture first, freeze-dry second |
| `extension/src/utils/api.ts` | Modify | Add `updateCaptureHtml()` function for phase-2 HTML upload |
| `src/main/services/captureServer.ts` | Modify | Add `PATCH /api/captures/:id/html` endpoint for deferred HTML update |
| `src/main/services/storage.ts` | Modify | Add `updateCaptureHtml()` to overwrite HTML file on disk |

---

## Phase 1: Server-Side Quick Wins

### Task 1: Defer entity extraction on manual and selector capture endpoints

**Files:**
- Modify: `src/main/services/captureServer.ts:338-341` (selector endpoint)
- Modify: `src/main/services/captureServer.ts:399-402` (manual endpoint)

Currently, the session capture endpoint (`/api/captures`) correctly defers extraction via `setImmediate()`, but the manual and selector endpoints run `runRuleBasedExtraction()` and `matchSelectorsForCapture()` synchronously before responding. This adds 50-400ms to the HTTP response time.

- [ ] **Step 1: Wrap extraction in setImmediate on selector endpoint**

In `captureServer.ts`, find the `/api/captures/selector` handler (around line 338). Replace the synchronous calls:

```typescript
// BEFORE (synchronous — blocks HTTP response)
runRuleBasedExtraction(capture.id, textContent)
if (textContent) {
  db.matchSelectorsForCapture(capture.id, caseId, textContent)
}
```

with deferred execution matching the session capture pattern:

```typescript
// AFTER (deferred — HTTP response returns immediately)
setImmediate(() => {
  try {
    runRuleBasedExtraction(capture.id, textContent)
  } catch (err) {
    console.error('Rule-based extraction error for capture', capture.id, err)
  }
  try {
    if (textContent) {
      db.matchSelectorsForCapture(capture.id, caseId, textContent)
    }
  } catch (err) {
    console.error('Selector matching error for capture', capture.id, err)
  }
})
```

- [ ] **Step 2: Wrap extraction in setImmediate on manual endpoint**

In `captureServer.ts`, find the `/api/captures/manual` handler (around line 399). Apply the same pattern:

```typescript
// BEFORE (synchronous — blocks HTTP response)
runRuleBasedExtraction(capture.id, textContent)
if (textContent) {
  db.matchSelectorsForCapture(capture.id, caseId, textContent)
}
```

```typescript
// AFTER (deferred)
setImmediate(() => {
  try {
    runRuleBasedExtraction(capture.id, textContent)
  } catch (err) {
    console.error('Rule-based extraction error for capture', capture.id, err)
  }
  try {
    if (textContent) {
      db.matchSelectorsForCapture(capture.id, caseId, textContent)
    }
  } catch (err) {
    console.error('Selector matching error for capture', capture.id, err)
  }
})
```

- [ ] **Step 3: Verify session capture endpoint pattern is consistent**

Confirm the existing session endpoint at `/api/captures` (around line 267) already uses `setImmediate()`. No changes needed — just verify for consistency.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/captureServer.ts
git commit -m "perf: defer entity extraction on manual and selector capture endpoints"
```

---

### Task 2: Batch entity inserts in a single transaction

**Files:**
- Modify: `src/main/services/captureServer.ts:88-98` (`runRuleBasedExtraction` function)

Currently, each extracted entity is inserted individually via `db.insertEntity()`, which creates N separate SQLite operations. With 20+ entities per page this is wasteful. Wrap them in a single transaction.

- [ ] **Step 1: Wrap entity insert loop in a transaction**

In `captureServer.ts`, find the `runRuleBasedExtraction` function (around line 75). Replace the individual insert loop:

```typescript
// BEFORE — N separate DB operations
for (const entity of entities) {
  db.insertEntity({
    captureId,
    type: entity.type,
    value: entity.value,
    context: entity.context,
    confidence: entity.confidence,
    source: 'rule'
  })
}
```

with a batched transaction. Import `getDb` from database if not already available, or add a batch function. The simplest approach is to use the existing `db` import and call the transaction wrapper:

```typescript
// AFTER — single transaction for all entities
const d = db.getDb()
const insertStmt = d.prepare(
  'INSERT INTO entities (id, capture_id, type, value, context, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
)
const batchInsert = d.transaction(() => {
  const now = new Date().toISOString()
  for (const entity of entities) {
    const id = crypto.randomUUID()
    insertStmt.run(
      id,
      captureId,
      entity.type,
      entity.value,
      entity.context ?? null,
      entity.confidence ?? null,
      'rule',
      now
    )
  }
})
batchInsert()
```

The preferred approach is to add an `insertEntitiesBatch` function to `database.ts` (which uses the existing `uuid()` import and `getDb()` pattern):

- [ ] **Step 2: Add `insertEntitiesBatch` to database.ts**

In `src/main/services/database.ts`, add after the existing `insertEntity` function:

```typescript
export function insertEntitiesBatch(entities: Array<Omit<Entity, 'id' | 'createdAt'>>): void {
  if (entities.length === 0) return
  const d = getDb()
  const stmt = d.prepare(
    'INSERT INTO entities (id, capture_id, type, value, context, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const run = d.transaction(() => {
    const now = new Date().toISOString()
    for (const e of entities) {
      stmt.run(uuid(), e.captureId, e.type, e.value, e.context ?? null, e.confidence ?? null, e.source ?? 'ai', now)
    }
  })
  run()
}
```

- [ ] **Step 3: Replace the insert loop in captureServer.ts**

In `captureServer.ts`, in the `runRuleBasedExtraction` function, replace the for-loop with:

```typescript
db.insertEntitiesBatch(
  entities.map(e => ({
    captureId,
    type: e.type,
    value: e.value,
    context: e.context,
    confidence: e.confidence,
    source: 'rule' as const
  }))
)
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/captureServer.ts src/main/services/database.ts
git commit -m "perf: batch entity inserts in single transaction"
```

---

## Phase 2: Two-Phase Capture + Browser Feedback

### Task 3: Create toast notification component

**Files:**
- Create: `extension/src/toast.ts`

Build a lightweight toast overlay using Shadow DOM (same isolation pattern as the existing sidebar in `extension/src/sidebar.ts`). The toast should:
- Appear in the bottom-right corner of the page
- Show "Capturing..." with a spinner initially
- Update to "Captured!" with a checkmark on success, or "Capture failed" on error
- Auto-dismiss after 2 seconds on success
- Use Shadow DOM to avoid style conflicts with the host page

- [ ] **Step 1: Create `extension/src/toast.ts`**

```typescript
const TOAST_ID = 'birdbrain-capture-toast'

interface ToastOptions {
  status: 'capturing' | 'success' | 'error'
  message?: string
}

function getOrCreateHost(): ShadowRoot {
  let host = document.getElementById(TOAST_ID)
  if (host?.shadowRoot) return host.shadowRoot

  host = document.createElement('div')
  host.id = TOAST_ID
  const shadow = host.attachShadow({ mode: 'open' })
  document.body.appendChild(host)
  return shadow
}

function getStyles(): string {
  return `
    :host {
      all: initial;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1;
      color: #fff;
      background: #1a1a2e;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s;
    }
    .toast.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .toast.success {
      border-color: rgba(34, 197, 94, 0.4);
    }
    .toast.error {
      border-color: rgba(239, 68, 68, 0.4);
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.2);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .icon {
      font-size: 14px;
    }
  `
}

export function showToast(options: ToastOptions): void {
  const shadow = getOrCreateHost()

  const icon =
    options.status === 'capturing' ? '<div class="spinner"></div>'
    : options.status === 'success' ? '<span class="icon">&#10003;</span>'
    : '<span class="icon">&#10007;</span>'

  const message =
    options.message ??
    (options.status === 'capturing' ? 'Capturing...'
    : options.status === 'success' ? 'Captured!'
    : 'Capture failed')

  const statusClass = options.status === 'capturing' ? '' : options.status

  shadow.innerHTML = `
    <style>${getStyles()}</style>
    <div class="toast ${statusClass}">
      ${icon}
      <span>${message}</span>
    </div>
  `

  // Trigger reflow then show
  const toast = shadow.querySelector('.toast') as HTMLElement
  requestAnimationFrame(() => {
    toast?.classList.add('visible')
  })
}

export function updateToast(options: ToastOptions): void {
  showToast(options)

  if (options.status === 'success' || options.status === 'error') {
    setTimeout(removeToast, 2000)
  }
}

export function removeToast(): void {
  const host = document.getElementById(TOAST_ID)
  if (!host?.shadowRoot) return

  const toast = host.shadowRoot.querySelector('.toast') as HTMLElement
  if (toast) {
    toast.classList.remove('visible')
    setTimeout(() => host.remove(), 200)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/toast.ts
git commit -m "feat(extension): add toast notification component for capture feedback"
```

---

### Task 4: Add fast page extraction message to content script

**Files:**
- Modify: `extension/src/content.ts:247-270` (message handler)

Add a new `EXTRACT_PAGE_FAST` message type that returns title + textContent + outerHTML immediately (no freeze-dry). The existing `EXTRACT_PAGE` continues to use freeze-dry for the archival phase.

Also add `SHOW_CAPTURE_TOAST` and `UPDATE_CAPTURE_TOAST` message handlers.

- [ ] **Step 1: Add toast import to content.ts**

At the top of `extension/src/content.ts`, add:

```typescript
import { showToast, updateToast, removeToast } from './toast'
```

- [ ] **Step 2: Add EXTRACT_PAGE_FAST handler**

In the `chrome.runtime.onMessage.addListener` callback in `content.ts`, add a new handler before the existing `EXTRACT_PAGE` handler:

```typescript
if (message.type === 'EXTRACT_PAGE_FAST') {
  const title = document.title
  const textContent = document.body?.innerText || ''
  const html = document.documentElement.outerHTML
  sendResponse({ html, title, textContent })
  return
}
```

This returns immediately with raw outerHTML — no freeze-dry wait.

- [ ] **Step 3: Add toast message handlers**

Add handlers for toast messages in the same listener:

```typescript
if (message.type === 'SHOW_CAPTURE_TOAST') {
  showToast({ status: 'capturing' })
  sendResponse({ ok: true })
  return
}

if (message.type === 'UPDATE_CAPTURE_TOAST') {
  updateToast({ status: message.status, message: message.message })
  sendResponse({ ok: true })
  return
}
```

- [ ] **Step 4: Commit**

```bash
git add extension/src/content.ts
git commit -m "feat(extension): add fast page extraction and toast message handlers"
```

---

### Task 5: Add PATCH endpoint for deferred HTML update

**Files:**
- Modify: `src/main/services/captureServer.ts` (add new endpoint)
- Modify: `src/main/services/storage.ts` (add `updateCaptureHtml` function)

The server needs a way to receive the freeze-dried HTML after the initial fast capture has already been stored.

- [ ] **Step 1: Add `updateCaptureHtml` to storage.ts**

In `src/main/services/storage.ts`, add a function to overwrite the HTML file for an existing capture. Use the existing `getStorageRoot()` and `ensureCaseDir()` pattern:

```typescript
export function updateCaptureHtml(caseId: string, captureId: string, html: string): void {
  const dir = ensureCaseDir(caseId)
  writeFileSync(join(dir, `${captureId}.html`), html, 'utf-8')
}
```

- [ ] **Step 2: Add `updateCaptureHash` to database.ts**

In `src/main/services/database.ts`, add:

```typescript
export function updateCaptureHash(captureId: string, hash: string): void {
  getDb().prepare('UPDATE captures SET hash = ? WHERE id = ?').run(hash, captureId)
}
```

- [ ] **Step 3: Update CORS to allow PATCH method**

In `src/main/services/captureServer.ts`, update the CORS middleware (around line 123):

```typescript
// BEFORE
allowMethods: ['GET', 'POST'],
// AFTER
allowMethods: ['GET', 'POST', 'PATCH'],
```

- [ ] **Step 4: Add imports and PATCH endpoint to captureServer.ts**

First, update the import from storage.ts at the top of `captureServer.ts`:

```typescript
// BEFORE
import { saveCapture } from '@main/services/storage'
// AFTER
import { saveCapture, updateCaptureHtml } from '@main/services/storage'
```

Then add the new route in `createApp()`:

```typescript
app.patch('/api/captures/:id/html', async (c) => {
  try {
    const captureId = c.req.param('id')
    const body = await c.req.json()
    const { html, caseId } = body

    if (!html || !caseId) {
      return c.json({ error: 'Missing required fields: html, caseId' }, 400)
    }

    const capture = db.getCapture(captureId)
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404)
    }

    // Overwrite HTML file on disk
    updateCaptureHtml(caseId, captureId, html)

    // Update hash in database
    const hash = hashContent(html)
    db.updateCaptureHash(captureId, hash)

    return c.json({ status: 'ok', captureId, hash })
  } catch (err) {
    console.error('HTML update error:', err)
    return c.json({ error: 'Failed to update capture HTML' }, 500)
  }
})

- [ ] **Step 5: Add updateCaptureHtml to extension API**

In `extension/src/utils/api.ts`, add:

```typescript
export async function updateCaptureHtml(captureId: string, caseId: string, html: string): Promise<{ status: string }> {
  return request(`/api/captures/${captureId}/html`, {
    method: 'PATCH',
    body: JSON.stringify({ html, caseId })
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/main/services/captureServer.ts src/main/services/storage.ts src/main/services/database.ts extension/src/utils/api.ts
git commit -m "feat: add PATCH endpoint for deferred HTML update"
```

---

### Task 6: Rewrite manualCaptureTab for two-phase capture

**Files:**
- Modify: `extension/src/background.ts:217-245` (`manualCaptureTab` function)

Rewrite the manual capture flow to:
1. Show toast immediately
2. Extract page fast (outerHTML, no freeze-dry)
3. Take screenshot
4. Send fast capture to server → capture appears in app
5. Update toast to "Captured!"
6. In background: run freeze-dry and PATCH the HTML

- [ ] **Step 1: Add import for updateCaptureHtml**

At the top of `background.ts`, update the import from `utils/api`:

```typescript
import { sendManualCapture, updateCaptureHtml } from './utils/api'
```

(Add `updateCaptureHtml` to the existing import.)

- [ ] **Step 2: Rewrite manualCaptureTab**

Replace the existing `manualCaptureTab` function:

```typescript
async function manualCaptureTab(tabId: number, url: string, caseId: string): Promise<void> {
  try {
    // Show capturing toast immediately
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_CAPTURE_TOAST' }).catch(() => {})

    // Phase 1: Fast extraction (outerHTML, no freeze-dry)
    const pageData = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_FAST' }) as {
      html: string
      title: string
      textContent: string
    }

    let screenshot: string | undefined
    try {
      screenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
      screenshot = screenshot.replace(/^data:image\/png;base64,/, '')
    } catch {
      // Screenshot capture can fail (e.g., chrome:// pages)
    }

    // Send fast capture to server — appears in app immediately
    const result = await sendManualCapture({
      caseId,
      url,
      title: pageData.title,
      html: pageData.html,
      screenshot,
      timestamp: new Date().toISOString(),
      textContent: pageData.textContent
    })

    // Update toast to success
    chrome.tabs.sendMessage(tabId, {
      type: 'UPDATE_CAPTURE_TOAST',
      status: 'success'
    }).catch(() => {})

    // Update badge (intentional addition — manual captures were not updating badge count before)
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })

    // Phase 2: Background freeze-dry and HTML update
    chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' })
      .then(async (archivedData: { html: string }) => {
        if (archivedData?.html && archivedData.html !== pageData.html) {
          await updateCaptureHtml(result.captureId, caseId, archivedData.html)
        }
      })
      .catch((err) => {
        console.warn('[Birdbrain] Background freeze-dry failed:', err)
      })
  } catch (err) {
    console.error('[Birdbrain] Manual capture failed:', err)
    // Update toast to error
    chrome.tabs.sendMessage(tabId, {
      type: 'UPDATE_CAPTURE_TOAST',
      status: 'error'
    }).catch(() => {})
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat(extension): two-phase manual capture with immediate feedback"
```

---

### Task 7: Build and manual test

- [ ] **Step 1: Build the extension**

```bash
pnpm build:extension
```

Verify no TypeScript or build errors.

- [ ] **Step 2: Build the Electron app**

```bash
pnpm build
```

Verify no TypeScript or build errors.

- [ ] **Step 3: Manual test checklist**

1. Start Electron app in dev mode (`pnpm dev`)
2. Load the extension in Chrome
3. Create/activate a case
4. Navigate to a content-rich page
5. Right-click → "Capture with Birdbrain"
6. **Verify**: Toast appears immediately saying "Capturing..."
7. **Verify**: Toast updates to "Captured!" within ~500ms
8. **Verify**: Capture appears in the Electron app almost immediately
9. **Verify**: After a few seconds, the archived HTML (freeze-dried) is available in the capture detail view
10. **Verify**: Entities are extracted (appear after a moment, not blocking the capture)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
