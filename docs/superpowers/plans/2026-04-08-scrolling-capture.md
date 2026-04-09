# Scrolling Full-Page Screenshot Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 20,000px height-capped full-page capture with a byte-budget-based system, restructure the context menu into a "Birdbrain" submenu, and add a scrolling capture mode that pre-scrolls infinite-scroll pages before stitching.

**Architecture:** The content script's `captureFullPage()` is refactored to stop based on a raw byte budget (100 MB) instead of a pixel height cap. A new `captureFullPageScrolling()` function adds a scroll-to-load phase (with 120s time limit and stall detection) before the stitch phase. The background script restructures the context menu into a parent "Birdbrain" menu with two children and adds a new orchestrator for the scrolling capture path. The server-side screenshot size limit is raised to 100 MB.

**Tech Stack:** Chrome Extension (Manifest V3), TypeScript, OffscreenCanvas, Chrome APIs (contextMenus, tabs, pageCapture)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `extension/src/content.ts` | Modify | Refactor `captureFullPage()` to use byte budget, add `captureFullPageScrolling()`, add `CAPTURE_FULL_PAGE_SCROLLING` message handler |
| `extension/src/background.ts` | Modify | Restructure context menu to parent+children, add scrolling capture orchestrator, update message payloads |
| `src/main/services/captureServer.ts` | Modify | Raise `MAX_SCREENSHOT_SIZE` from 10 MB to 100 MB |

---

### Task 1: Raise Server-Side Screenshot Size Limit

**Files:**
- Modify: `src/main/services/captureServer.ts:300`

This is the simplest change and unblocks all downstream work. Without it, the server silently drops any screenshot larger than 10 MB.

- [ ] **Step 1: Update `MAX_SCREENSHOT_SIZE` constant**

In `src/main/services/captureServer.ts`, change line 300 from:

```typescript
const MAX_SCREENSHOT_SIZE = 10 * 1024 * 1024 // 10 MB
```

to:

```typescript
const MAX_SCREENSHOT_SIZE = 100 * 1024 * 1024 // 100 MB
```

- [ ] **Step 2: Verify the app builds**

Run: `pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/captureServer.ts
git commit -m "feat: raise max screenshot size from 10 MB to 100 MB"
```

---

### Task 2: Refactor `captureFullPage()` to Use Byte Budget

**Files:**
- Modify: `extension/src/content.ts:241-393`

Replace the `maxHeight` parameter with `maxBytes`. Instead of pre-computing `totalHeight = Math.min(scrollHeight, maxHeight)` and a fixed slice count, the function now captures slices in a loop, accumulating raw bitmap bytes after each slice, and stops when the budget is exceeded or the page is fully captured.

- [ ] **Step 1: Update the `captureFullPage` function signature and stopping logic**

Replace the entire `captureFullPage` function (lines 241-366) with:

```typescript
const CAPTURE_MAX_BYTES = 100 * 1024 * 1024 // 100 MB raw bitmap budget

async function captureFullPage(maxBytes: number = CAPTURE_MAX_BYTES): Promise<string> {
  if (captureInProgress) {
    throw new Error('Capture already in progress')
  }
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available in this context')
  }

  captureInProgress = true
  const savedScrollX = window.scrollX
  const savedScrollY = window.scrollY

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const dpr = window.devicePixelRatio || 1
  // Raw bytes per viewport slice: width * height * 4 (RGBA) * dpr^2
  const bytesPerSlice = viewportWidth * viewportHeight * 4 * dpr * dpr
  const totalHeight = document.documentElement.scrollHeight
  const maxSlices = Math.ceil(totalHeight / viewportHeight)

  // Collect sticky/fixed elements to hide during capture
  const stickyElements = collectStickyElements()

  const slices: Array<{ dataUrl: string; yOffset: number }> = []
  let accumulatedBytes = 0

  try {
    for (let i = 0; i < maxSlices; i++) {
      // Check byte budget before capturing this slice
      if (accumulatedBytes + bytesPerSlice > maxBytes && slices.length > 0) {
        console.log('[Birdbrain] Byte budget reached after', slices.length, 'slices')
        break
      }

      const yOffset = i * viewportHeight

      // Hide sticky elements after first slice (so headers appear at top)
      if (i === 1) {
        for (const entry of stickyElements) {
          entry.el.style.setProperty('position', 'relative', 'important')
        }
      }

      window.scrollTo(0, yOffset)
      await new Promise((r) => setTimeout(r, 150))

      try {
        const response = await chrome.runtime.sendMessage({ type: 'REQUEST_VIEWPORT_CAPTURE' })
        if (response?.dataUrl) {
          slices.push({ dataUrl: response.dataUrl, yOffset })
          accumulatedBytes += bytesPerSlice
        } else {
          console.warn('[Birdbrain] Viewport capture returned no data for slice', i)
        }
      } catch (err) {
        console.warn('[Birdbrain] Viewport capture failed for slice', i, err)
      }
    }

    // Stitch slices onto OffscreenCanvas
    const capturedHeight = slices.length > 0
      ? slices[slices.length - 1].yOffset + viewportHeight
      : viewportHeight
    const clampedHeight = Math.min(capturedHeight, totalHeight)
    const bitmapTotalHeight = Math.round(clampedHeight * dpr)

    const canvas = new OffscreenCanvas(Math.round(viewportWidth * dpr), bitmapTotalHeight)
    const ctx = canvas.getContext('2d')!

    for (const slice of slices) {
      const img = await createImageBitmapFromDataUrl(slice.dataUrl)
      const destY = Math.round(slice.yOffset * dpr)
      const destH = Math.min(img.height, bitmapTotalHeight - destY)
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, destY, img.width, destH)
      img.close()
    }

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return await blobToDataUrl(blob)
  } finally {
    captureInProgress = false
    restoreStickyElements(stickyElements)
    window.scrollTo(savedScrollX, savedScrollY)
  }
}
```

- [ ] **Step 2: Extract sticky element helpers**

Add these two helper functions right above `captureFullPage` (after `removeHighlights` and before the `captureInProgress` variable):

```typescript
type StickyEntry = { el: HTMLElement; origValue: string; origPriority: string }

const STICKY_FIXED_SELECTORS = [
  'header',
  'nav',
  'footer',
  '[role="banner"]',
  '[role="navigation"]',
  '[class~="sticky"]',
  '[class~="fixed"]',
  '[class*="navbar"]',
  '[class*="topbar"]',
  '[class*="top-bar"]',
  '[style*="position:fixed"]',
  '[style*="position: fixed"]',
  '[style*="position:sticky"]',
  '[style*="position: sticky"]',
].join(', ')

function collectStickyElements(): StickyEntry[] {
  const entries: StickyEntry[] = []
  document.querySelectorAll(STICKY_FIXED_SELECTORS).forEach((node) => {
    const el = node as HTMLElement
    const style = getComputedStyle(el)
    if (style.position === 'fixed' || style.position === 'sticky') {
      entries.push({
        el,
        origValue: el.style.getPropertyValue('position'),
        origPriority: el.style.getPropertyPriority('position'),
      })
    }
  })
  return entries
}

function restoreStickyElements(entries: StickyEntry[]): void {
  for (const entry of entries) {
    if (entry.origValue) {
      entry.el.style.setProperty('position', entry.origValue, entry.origPriority)
    } else {
      entry.el.style.removeProperty('position')
    }
  }
}
```

- [ ] **Step 3: Update the `CAPTURE_FULL_PAGE` message handler**

Replace the existing handler (lines 386-393) with:

```typescript
  if (message.type === 'CAPTURE_FULL_PAGE') {
    const maxBytes: number = message.maxBytes || CAPTURE_MAX_BYTES
    captureFullPage(maxBytes).then(
      (dataUrl) => sendResponse({ screenshot: dataUrl }),
      (err) => sendResponse({ error: String(err) })
    )
    return true // keep channel open for async response
  }
```

- [ ] **Step 4: Build the extension and verify no errors**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content.ts
git commit -m "refactor: replace height cap with byte budget in captureFullPage"
```

---

### Task 3: Add Scrolling Capture Mode to Content Script

**Files:**
- Modify: `extension/src/content.ts`

Add the `captureFullPageScrolling()` function and its message handler. This function has two phases: scroll-to-load (with time limit and stall detection) and then the standard byte-budget stitch.

- [ ] **Step 1: Add scrolling capture constants**

Add these constants right after the `CAPTURE_MAX_BYTES` constant (added in Task 2):

```typescript
const SCROLL_TIMEOUT_MS = 120 * 1000   // 120 seconds for scroll phase
const SCROLL_PAUSE_MS = 500            // pause between scrolls for lazy-load
const SCROLL_STALL_THRESHOLD = 3       // stop if scrollHeight unchanged this many times
```

- [ ] **Step 2: Add the `captureFullPageScrolling` function**

Add this function right after `captureFullPage`:

```typescript
async function captureFullPageScrolling(
  maxBytes: number = CAPTURE_MAX_BYTES,
  scrollTimeoutMs: number = SCROLL_TIMEOUT_MS
): Promise<string> {
  if (captureInProgress) {
    throw new Error('Capture already in progress')
  }

  captureInProgress = true
  const savedScrollX = window.scrollX
  const savedScrollY = window.scrollY
  const viewportHeight = window.innerHeight

  try {
    // Phase 1: Scroll to load content
    const startTime = Date.now()
    let stalls = 0
    let lastScrollHeight = document.documentElement.scrollHeight

    while (Date.now() - startTime < scrollTimeoutMs) {
      window.scrollBy(0, viewportHeight)
      await new Promise((r) => setTimeout(r, SCROLL_PAUSE_MS))

      const currentScrollHeight = document.documentElement.scrollHeight
      if (currentScrollHeight === lastScrollHeight) {
        stalls++
        if (stalls >= SCROLL_STALL_THRESHOLD) {
          console.log('[Birdbrain] Scroll stalled after', stalls, 'attempts — page end reached')
          break
        }
      } else {
        stalls = 0
        lastScrollHeight = currentScrollHeight
      }
    }

    if (Date.now() - startTime >= scrollTimeoutMs) {
      console.log('[Birdbrain] Scroll phase timed out after', scrollTimeoutMs / 1000, 'seconds')
    }

    // Phase 2: Scroll back to top and capture with byte budget
    window.scrollTo(0, 0)
    await new Promise((r) => setTimeout(r, 150))

    // Release the captureInProgress lock so captureFullPage can acquire it
    captureInProgress = false
    return await captureFullPage(maxBytes)
  } catch (err) {
    captureInProgress = false
    // Restore scroll position on error
    window.scrollTo(savedScrollX, savedScrollY)
    throw err
  }
}
```

- [ ] **Step 3: Add the `CAPTURE_FULL_PAGE_SCROLLING` message handler**

Add this handler right after the `CAPTURE_FULL_PAGE` handler in the `chrome.runtime.onMessage.addListener` block:

```typescript
  if (message.type === 'CAPTURE_FULL_PAGE_SCROLLING') {
    const maxBytes: number = message.maxBytes || CAPTURE_MAX_BYTES
    const scrollTimeoutMs: number = message.scrollTimeoutMs || SCROLL_TIMEOUT_MS
    captureFullPageScrolling(maxBytes, scrollTimeoutMs).then(
      (dataUrl) => sendResponse({ screenshot: dataUrl }),
      (err) => sendResponse({ error: String(err) })
    )
    return true // keep channel open for async response
  }
```

- [ ] **Step 4: Build and verify**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content.ts
git commit -m "feat: add scrolling capture mode with time limit and stall detection"
```

---

### Task 4: Restructure Context Menu and Add Scrolling Orchestrator to Background Script

**Files:**
- Modify: `extension/src/background.ts`

Restructure the context menu from a flat "Capture with Birdbrain" item into a "Birdbrain" parent with two children. Add a `captureScrollingPageScreenshot()` orchestrator. Update `captureFullPageScreenshot()` to send `maxBytes` instead of `maxHeight`.

- [ ] **Step 1: Update context menu IDs**

Replace the existing menu ID constants (lines 97-98):

```typescript
const CONTEXT_MENU_ID = 'birdbrain-capture-page'
const SELECTOR_CONTEXT_MENU_ID = 'birdbrain-create-selector'
```

with:

```typescript
const CONTEXT_MENU_PARENT_ID = 'birdbrain-parent'
const CONTEXT_MENU_FULL_PAGE_ID = 'birdbrain-capture-full-page'
const CONTEXT_MENU_SCROLLING_ID = 'birdbrain-capture-scrolling'
const SELECTOR_CONTEXT_MENU_ID = 'birdbrain-create-selector'
```

- [ ] **Step 2: Update `onInstalled` to create submenu structure**

Replace the `chrome.runtime.onInstalled.addListener` block (lines 221-234) with:

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_PARENT_ID,
    title: 'Birdbrain',
    contexts: ['page'],
    enabled: false
  })
  chrome.contextMenus.create({
    id: CONTEXT_MENU_FULL_PAGE_ID,
    parentId: CONTEXT_MENU_PARENT_ID,
    title: 'Capture Full Page',
    contexts: ['page']
  })
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SCROLLING_ID,
    parentId: CONTEXT_MENU_PARENT_ID,
    title: 'Capture Full Page (Scrolling)',
    contexts: ['page']
  })
  chrome.contextMenus.create({
    id: SELECTOR_CONTEXT_MENU_ID,
    title: 'Create Selector from Selection',
    contexts: ['selection'],
    enabled: false
  })
})
```

- [ ] **Step 3: Update context menu enable/disable in `checkStatus()`**

Replace the context menu update block (lines 190-200) with:

```typescript
    // Update context menu enabled state
    const menuEnabled = connected && !!activeCaseId
    chrome.contextMenus
      .update(CONTEXT_MENU_PARENT_ID, { enabled: menuEnabled })
      .catch(() => {})
    chrome.contextMenus
      .update(SELECTOR_CONTEXT_MENU_ID, { enabled: menuEnabled })
      .catch(() => {})
```

Note: Child items inherit the parent's enabled state, so we only need to toggle the parent and the selector item.

- [ ] **Step 4: Update `captureFullPageScreenshot()` to send `maxBytes`**

Replace the existing `captureFullPageScreenshot` function (lines 59-81) with:

```typescript
const CAPTURE_MAX_BYTES = 100 * 1024 * 1024 // 100 MB

async function captureFullPageScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_FULL_PAGE',
      maxBytes: CAPTURE_MAX_BYTES
    })
    if (response?.screenshot) {
      const res = await fetch(response.screenshot)
      return await res.blob()
    }
    if (response?.error) {
      console.warn(
        '[Birdbrain] Full-page capture failed, falling back to viewport:',
        response.error
      )
    }
    return captureScreenshot(tabId)
  } catch {
    return captureScreenshot(tabId)
  }
}
```

- [ ] **Step 5: Add `captureScrollingPageScreenshot()` orchestrator**

Add this function right after `captureFullPageScreenshot`:

```typescript
async function captureScrollingPageScreenshot(tabId: number): Promise<Blob | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'CAPTURE_FULL_PAGE_SCROLLING',
      maxBytes: CAPTURE_MAX_BYTES,
      scrollTimeoutMs: 120_000
    })
    if (response?.screenshot) {
      const res = await fetch(response.screenshot)
      return await res.blob()
    }
    if (response?.error) {
      console.warn(
        '[Birdbrain] Scrolling capture failed, falling back to full-page:',
        response.error
      )
    }
    // Fallback to non-scrolling full-page capture
    return captureFullPageScreenshot(tabId)
  } catch {
    // Content script unreachable — fallback
    return captureFullPageScreenshot(tabId)
  }
}
```

- [ ] **Step 6: Update the `onClicked` handler for the new menu structure**

Replace the manual capture dispatch block. Find:

```typescript
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
```

Replace with:

```typescript
  if (
    info.menuItemId !== CONTEXT_MENU_FULL_PAGE_ID &&
    info.menuItemId !== CONTEXT_MENU_SCROLLING_ID
  ) return
  if (!tab?.id || !tab.url) return
  if (!connected) return
  if (DEFAULT_IGNORE.some((pattern) => pattern.test(tab.url!))) return
  if (isIgnoredByUser(tab.url!)) return

  const targetCaseId = activeCaseId
  if (!targetCaseId) {
    console.warn('[Birdbrain] Manual capture skipped: no active case')
    return
  }

  const scrolling = info.menuItemId === CONTEXT_MENU_SCROLLING_ID
  manualCaptureTab(tab.id, tab.url, targetCaseId, scrolling)
```

- [ ] **Step 7: Update `manualCaptureTab` to accept a scrolling parameter**

Replace the `manualCaptureTab` function signature and the screenshot line. Change:

```typescript
async function manualCaptureTab(tabId: number, url: string, caseId: string): Promise<void> {
```

to:

```typescript
async function manualCaptureTab(tabId: number, url: string, caseId: string, scrolling: boolean = false): Promise<void> {
```

And replace the `Promise.all` screenshot entry (line 419):

```typescript
      captureScreenshotsEnabled ? captureFullPageScreenshot(tabId) : Promise.resolve(undefined)
```

with:

```typescript
      captureScreenshotsEnabled
        ? (scrolling ? captureScrollingPageScreenshot(tabId) : captureFullPageScreenshot(tabId))
        : Promise.resolve(undefined)
```

- [ ] **Step 8: Build and verify**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: restructure context menu and add scrolling capture orchestrator"
```

---

### Task 5: Manual Testing

No unit tests for Chrome extension content/background scripts (they require the Chrome runtime). Verify behavior manually.

- [ ] **Step 1: Build the extension**

Run: `pnpm build:extension`

- [ ] **Step 2: Load the extension in Chrome**

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select `extension/dist`
4. Ensure the Birdbrain app is running with an active session and case

- [ ] **Step 3: Test context menu structure**

1. Right-click on any page
2. Verify: "Birdbrain" parent menu appears with two children: "Capture Full Page" and "Capture Full Page (Scrolling)"
3. Verify: "Create Selector from Selection" still appears when text is selected
4. Disconnect from Birdbrain (stop the app) → verify all menu items are disabled

- [ ] **Step 4: Test "Capture Full Page" on a long page**

1. Navigate to a long Wikipedia article or similar page with height > 20,000px
2. Right-click → Birdbrain → "Capture Full Page"
3. Verify: toast appears, capture succeeds
4. Verify: screenshot in the Birdbrain app is taller than the viewport (full page captured)
5. Verify: scroll position is restored after capture

- [ ] **Step 5: Test "Capture Full Page (Scrolling)" on an infinite-scroll page**

1. Navigate to a social media feed or infinite-scroll page
2. Right-click → Birdbrain → "Capture Full Page (Scrolling)"
3. Verify: page scrolls down automatically, loading new content
4. Verify: scrolling stops (either stall detection or time limit)
5. Verify: capture completes and screenshot appears in Birdbrain
6. Verify: scroll position is restored

- [ ] **Step 6: Test short page (both modes identical)**

1. Navigate to a short page (e.g., example.com)
2. Test both "Capture Full Page" and "Capture Full Page (Scrolling)"
3. Verify: both produce a similar screenshot — the scrolling mode should detect stall immediately

- [ ] **Step 7: Test existing capture paths unchanged**

1. Verify toolbar button capture still works (uses non-scrolling full-page)
2. Verify selector-matched captures still work (uses non-scrolling full-page)
3. Verify auto-captures still use viewport-only screenshots

- [ ] **Step 8: Build the full app and run tests**

Run: `pnpm build && pnpm test`
Expected: All existing tests pass. Build succeeds.

- [ ] **Step 9: Commit any fixes**

If any issues were found and fixed during testing:

```bash
git add extension/src/content.ts extension/src/background.ts
git commit -m "fix: address issues found during scrolling capture testing"
```
