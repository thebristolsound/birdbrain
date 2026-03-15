# Manual Capture Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Chrome context menu item "Capture with Birdbrain" so users can manually capture specific pages on demand.

**Architecture:** Register a context menu in the background script that reuses the existing `captureTab()` flow. The menu item is enabled/disabled based on session state. No new endpoints or content script changes needed.

**Tech Stack:** Chrome Extensions API (`chrome.contextMenus`), TypeScript

---

### Task 1: Add contextMenus permission to manifest

**Files:**
- Modify: `extension/manifest.json`

**Step 1: Add the permission**

In `extension/manifest.json`, add `"contextMenus"` to the `permissions` array:

```json
"permissions": [
  "activeTab",
  "tabs",
  "scripting",
  "storage",
  "notifications",
  "contextMenus"
],
```

**Step 2: Commit**

```bash
git add extension/manifest.json
git commit -m "feat: add contextMenus permission to extension manifest"
```

---

### Task 2: Register context menu in background script

**Files:**
- Modify: `extension/src/background.ts`

**Step 1: Add context menu creation**

Add this block after the `checkStatus()` initial call (around line 89) in `extension/src/background.ts`:

```typescript
// --- Context menu for manual capture ---

const CONTEXT_MENU_ID = 'birdbrain-capture-page'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Capture with Birdbrain',
    contexts: ['page'],
    enabled: false
  })
})
```

**Step 2: Add click handler**

Add this block immediately after the context menu creation:

```typescript
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return
  if (!tab?.id || !tab.url) return
  if (!sessionActive || !connected) return

  // Manual capture — skip dedupe (user explicitly chose to capture)
  captureTab(tab.id, tab.url)
})
```

**Step 3: Update menu enabled state in checkStatus()**

In the `checkStatus()` function, add context menu state updates. After the `sessionActive` check block (after line 75), add:

```typescript
// Update context menu enabled state
chrome.contextMenus.update(CONTEXT_MENU_ID, {
  enabled: connected && sessionActive
}).catch(() => {
  // Menu may not exist yet
})
```

**Step 4: Build the extension and verify no TypeScript errors**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors

**Step 5: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: add manual capture via right-click context menu"
```

---

### Task 3: Manual testing

**Step 1: Load the updated extension in Chrome**

1. Run `pnpm build:extension`
2. Go to `chrome://extensions`, reload the Birdbrain extension
3. Start the Electron app with `pnpm dev`

**Step 2: Verify menu appears disabled when no session**

Right-click on any page. "Capture with Birdbrain" should appear but be grayed out.

**Step 3: Verify menu enables when session starts**

1. Open the extension popup
2. Select a case and click "Start Capturing"
3. Right-click on a page — "Capture with Birdbrain" should now be enabled

**Step 4: Verify capture works**

1. Navigate to a page
2. Right-click → "Capture with Birdbrain"
3. Check the Electron app — the capture should appear in the active case
4. Badge count should increment

**Step 5: Verify re-capture works (no dedupe)**

1. Right-click → "Capture with Birdbrain" on the same page again
2. A second capture should be created (not deduped)
