# Manual Capture via Context Menu

## Problem

The Chrome extension auto-captures every page on load with no way to manually capture a specific page. Investigators need precise control over what gets captured.

## Solution

Add a Chrome context menu item "Capture with Birdbrain" that triggers the existing capture flow on demand. Auto-capture remains as an independent toggle that can run alongside manual capture.

## Architecture

One context menu item registered in the background script. Enabled only when a session is active with a selected case. Clicking it reuses the existing `captureTab()` flow: extract page via content script, screenshot, send to Hono server.

### Changes

**`extension/src/background.ts`:**
- Register context menu on install/startup via `chrome.contextMenus.create()`
- Update enabled state in `checkStatus()` when session/connection changes
- Handle click via `chrome.contextMenus.onClicked` → `captureTab()`
- Skip dedupe for manual captures (user explicitly chose to capture)

**`extension/manifest.json`:**
- Add `"contextMenus"` to permissions

No other files change.

### Data flow

```
Right-click → "Capture with Birdbrain"
  → background.ts contextMenus.onClicked
  → captureTab(tabId, url) [skip dedupe]
  → content script EXTRACT_PAGE → HTML + title + text
  → chrome.tabs.captureVisibleTab → screenshot
  → POST /api/captures → disk + SQLite
  → badge count updates
```

### Error handling

- No active session → menu item grayed out (disabled)
- Content script not injected (chrome:// pages) → capture fails silently
- Server disconnected → capture fails, logs to console

### Testing

- Unit test: context menu created with correct properties
- Manual test: right-click during active session, confirm capture in Electron app
