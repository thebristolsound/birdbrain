# Full-Page Screenshot Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace viewport-only screenshots with full-page scroll-and-stitch capture for manual and selector captures, while wiring up the existing `captureScreenshots` setting so it actually controls screenshot behavior.

**Architecture:** The content script gains a new `CAPTURE_FULL_PAGE` message handler that scrolls the page, requests viewport slices from the background script via `REQUEST_VIEWPORT_CAPTURE`, stitches them on an OffscreenCanvas, and returns a PNG data URL. The background script orchestrates which capture path to use based on source type and the `captureScreenshots` setting (now communicated via `/api/status`).

**Tech Stack:** Chrome Extension APIs (`captureVisibleTab`, `tabs.sendMessage`), OffscreenCanvas, Hono (capture server), TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/services/captureServer.ts` | Modify (line 165) | Add `captureScreenshots` to `/api/status` response |
| `extension/src/utils/api.ts` | Modify (line 12-20) | Add `captureScreenshots` to `StatusResponse` interface |
| `extension/src/background.ts` | Modify | Add `captureScreenshots` state variable, `captureFullPageScreenshot()` orchestrator, `REQUEST_VIEWPORT_CAPTURE` handler, conditional screenshot logic in all 3 capture paths |
| `extension/src/content.ts` | Modify | Add `CAPTURE_FULL_PAGE` handler with scroll-stitch algorithm and sticky element management |

---

### Task 1: Wire `captureScreenshots` Setting to Extension via `/api/status`

**Files:**
- Modify: `src/main/services/captureServer.ts:158-166`
- Modify: `extension/src/utils/api.ts:12-20`
- Modify: `extension/src/background.ts:78-96,100-111`

- [ ] **Step 1: Add `captureScreenshots` to the `/api/status` response**

In `src/main/services/captureServer.ts`, add the setting to the JSON response object. The `settings` variable is already available on line 156.

```typescript
// In the return c.json({ ... }) block around line 158-166, add after ignoredUrlPatterns:
      ignoredUrlPatterns: settings.ignoredUrlPatterns,
      captureScreenshots: settings.captureScreenshots
```

- [ ] **Step 2: Add `captureScreenshots` to `StatusResponse` interface**

In `extension/src/utils/api.ts`, add the field to the `StatusResponse` interface (lines 12-20):

```typescript
interface StatusResponse {
  running: boolean
  activeCase: { id: string; name: string } | null
  sessionActive: boolean
  captureCount: number
  autoCaptureMode?: string
  cases?: Array<{ id: string; name: string }>
  ignoredUrlPatterns?: string[]
  captureScreenshots?: boolean
}
```

- [ ] **Step 3: Add module-level `captureScreenshots` variable and read it in `checkStatus()`**

In `extension/src/background.ts`, add the variable after line 96 (`let userIgnoredPatterns: string[] = []`):

```typescript
let captureScreenshotsEnabled = true
```

Then in `checkStatus()`, after line 111 (`userIgnoredPatterns = status.ignoredUrlPatterns || []`), add:

```typescript
    captureScreenshotsEnabled = status.captureScreenshots !== false
```

- [ ] **Step 4: Guard screenshot capture in `captureTab` (auto-capture path)**

In `extension/src/background.ts`, modify `captureTab` (lines 347-376). Replace the `Promise.all` block:

```typescript
async function captureTab(tabId: number, url: string): Promise<void> {
  try {
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshotsEnabled ? captureScreenshot(tabId) : Promise.resolve(undefined)
    ])

    await sendMhtmlCapture({
      source: 'auto',
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      screenshot,
      mhtml: mhtmlBlob,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200
    })

    dedupeMap.set(url, Date.now())
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })
  } catch (err) {
    console.error('Capture failed:', err)
  }
}
```

- [ ] **Step 5: Build the extension and verify no TypeScript errors**

Run: `pnpm build:extension`
Expected: Clean build with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/captureServer.ts extension/src/utils/api.ts extension/src/background.ts
git commit -m "feat: wire captureScreenshots setting to extension via /api/status"
```

---

### Task 2: Add `CAPTURE_FULL_PAGE` Handler to Content Script

**Files:**
- Modify: `extension/src/content.ts`

- [ ] **Step 1: Add the `CAPTURE_FULL_PAGE` message handler**

In `extension/src/content.ts`, add the following handler inside the existing `chrome.runtime.onMessage.addListener` callback, before the final `return true` on line 275:

```typescript
  if (message.type === 'CAPTURE_FULL_PAGE') {
    const maxHeight: number = message.maxHeight || 20000
    captureFullPage(maxHeight).then(
      (dataUrl) => sendResponse({ screenshot: dataUrl }),
      (err) => sendResponse({ error: String(err) })
    )
    return true // keep channel open for async response
  }
```

- [ ] **Step 2: Implement the `captureFullPage` function**

Add this function before the message handlers section (before line 239 `// --- Message handlers ---`):

```typescript
async function captureFullPage(maxHeight: number): Promise<string> {
  const savedScrollX = window.scrollX
  const savedScrollY = window.scrollY

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const totalHeight = Math.min(document.documentElement.scrollHeight, maxHeight)
  const sliceCount = Math.ceil(totalHeight / viewportHeight)

  // Hide sticky/fixed elements to prevent them repeating across slices
  const stickyElements: Array<{ el: HTMLElement; position: string }> = []
  document.querySelectorAll('*').forEach((el) => {
    const style = getComputedStyle(el)
    if (style.position === 'fixed' || style.position === 'sticky') {
      stickyElements.push({ el: el as HTMLElement, position: style.position })
    }
  })

  const slices: Array<{ dataUrl: string; yOffset: number }> = []

  try {
    for (let i = 0; i < sliceCount; i++) {
      const yOffset = i * viewportHeight

      // Hide sticky elements after first slice (so headers appear at top)
      if (i === 1) {
        for (const { el } of stickyElements) {
          el.style.setProperty('position', 'relative', 'important')
        }
      }

      window.scrollTo(0, yOffset)
      // Wait for paint to settle
      await new Promise((r) => setTimeout(r, 150))

      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_VIEWPORT_CAPTURE' })
      if (response?.dataUrl) {
        slices.push({ dataUrl: response.dataUrl, yOffset })
      }
    }

    // Stitch slices onto OffscreenCanvas
    const canvas = new OffscreenCanvas(viewportWidth, totalHeight)
    const ctx = canvas.getContext('2d')!

    for (const slice of slices) {
      const img = await createImageBitmapFromDataUrl(slice.dataUrl)
      const drawHeight = Math.min(viewportHeight, totalHeight - slice.yOffset)
      ctx.drawImage(img, 0, 0, viewportWidth, drawHeight, 0, slice.yOffset, viewportWidth, drawHeight)
      img.close()
    }

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return await blobToDataUrl(blob)
  } finally {
    // Restore sticky elements
    for (const { el, position } of stickyElements) {
      el.style.setProperty('position', position)
    }
    // Restore scroll position
    window.scrollTo(savedScrollX, savedScrollY)
  }
}

async function createImageBitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return createImageBitmap(blob)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
```

- [ ] **Step 3: Build the extension and verify no TypeScript errors**

Run: `pnpm build:extension`
Expected: Clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add extension/src/content.ts
git commit -m "feat: add full-page scroll-and-stitch capture to content script"
```

---

### Task 3: Add `REQUEST_VIEWPORT_CAPTURE` Handler and Full-Page Orchestrator to Background Script

**Files:**
- Modify: `extension/src/background.ts`

- [ ] **Step 1: Add `REQUEST_VIEWPORT_CAPTURE` message handler**

In `extension/src/background.ts`, add a new handler inside the first `chrome.runtime.onMessage.addListener` block (the one starting at line 551). Add before the existing `if (message.type === 'GET_STATE')` check:

```typescript
  if (message.type === 'REQUEST_VIEWPORT_CAPTURE') {
    if (!sender.tab?.id) {
      sendResponse({ error: 'No tab ID' })
      return true
    }
    const tab = sender.tab
    chrome.tabs
      .captureVisibleTab(tab.windowId!, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: String(err) }))
    return true // keep channel open for async
  }
```

- [ ] **Step 2: Add `captureFullPageScreenshot` orchestrator function**

Add this function after the existing `captureScreenshot` function (after line 53):

```typescript
async function captureFullPageScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_FULL_PAGE',
      maxHeight: 20000
    })
    if (response?.screenshot) {
      const res = await fetch(response.screenshot)
      return await res.blob()
    }
    if (response?.error) {
      console.warn('[Birdbrain] Full-page capture failed, falling back to viewport:', response.error)
    }
    // Fallback to viewport capture
    return captureScreenshot(tabId)
  } catch {
    // Content script unreachable — fallback to viewport capture
    return captureScreenshot(tabId)
  }
}
```

- [ ] **Step 3: Update `manualCaptureTab` to use full-page capture**

Replace the `Promise.all` block in `manualCaptureTab` (lines 385-389):

```typescript
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshotsEnabled
        ? captureFullPageScreenshot(tabId)
        : Promise.resolve(undefined)
    ])
```

- [ ] **Step 4: Update `handleSelectorCapture` to use full-page capture**

Replace the `Promise.all` block in `handleSelectorCapture` (lines 438-443):

```typescript
    const [mhtmlBlob, tab, textContent, screenshot] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId),
      captureScreenshotsEnabled
        ? captureFullPageScreenshot(tabId)
        : Promise.resolve(undefined)
    ])
```

- [ ] **Step 5: Build the extension and verify no TypeScript errors**

Run: `pnpm build:extension`
Expected: Clean build with no errors.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: add full-page screenshot orchestrator and viewport capture handler"
```

---

### Task 4: Manual Testing & Edge Case Verification

**Files:**
- None (testing only)

- [ ] **Step 1: Build the full app**

Run: `pnpm build && pnpm build:extension`
Expected: Clean builds.

- [ ] **Step 2: Load the extension in Chrome and start the app**

1. Run `pnpm dev` to start the Electron app
2. In Chrome, go to `chrome://extensions`, enable Developer Mode
3. Load the built extension from `extension/dist`
4. Verify the extension connects (icon changes from disconnected state)

- [ ] **Step 3: Test manual capture on a short page**

1. Create a case and start a session in Birdbrain
2. Navigate to a page shorter than the viewport (e.g., a simple search results page)
3. Right-click > "Capture with Birdbrain"
4. Verify: screenshot saved as PNG, shows the page content
5. Verify: page did not visibly scroll (only one slice needed)

- [ ] **Step 4: Test manual capture on a long page**

1. Navigate to a long article (e.g., a Wikipedia article)
2. Scroll to the middle of the page
3. Right-click > "Capture with Birdbrain"
4. Verify: saved PNG is taller than the viewport (full-page capture)
5. Verify: scroll position returned to where you were (middle of page)
6. Verify: no repeated sticky headers across the capture

- [ ] **Step 5: Test auto-capture stays viewport-only**

1. Enable auto-capture mode in Birdbrain settings
2. Navigate to a long page
3. Wait for auto-capture to trigger
4. Verify: saved screenshot is viewport-sized only (not a tall full-page image)
5. Verify: page did NOT scroll during the capture

- [ ] **Step 6: Test `captureScreenshots` toggle**

1. Go to Settings > Capture Preferences
2. Toggle "Capture Screenshots" OFF
3. Trigger a manual capture
4. Verify: no PNG file saved for that capture (only MHTML)
5. Toggle it back ON and capture again
6. Verify: PNG is saved

- [ ] **Step 7: Test fallback on chrome:// pages**

1. Navigate to `chrome://settings`
2. Right-click > "Capture with Birdbrain" (will fail for other reasons, but if somehow triggered)
3. Verify: no crash; capture either skips or falls back to viewport gracefully

- [ ] **Step 8: Test on infinite-scroll page**

1. Navigate to a page with very long/infinite content
2. Trigger a manual capture
3. Verify: screenshot stops at roughly 20,000px height (not infinite)
4. Verify: page scroll position is restored

- [ ] **Step 9: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: address issues found during full-page screenshot testing"
```

(Only if fixes were needed — skip if everything passed.)
