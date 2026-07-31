# Scrolling Full-Page Screenshot Capture

## Problem

The current full-page screenshot capture has a hard 20,000px height cap that truncates long pages. For investigation workflows, analysts need to capture the full extent of a page — including content that only appears after scrolling triggers lazy-loading or infinite-scroll mechanisms. The capture system also lacks a way for users to choose between a quick static capture and a thorough scrolling capture.

## Solution

Replace the pixel height cap with a raw byte budget (100 MB), restructure the Chrome extension context menu to offer two capture modes, and add a scrolling capture mode that pre-scrolls the page to load dynamic content before stitching.

### Context menu restructure

Current flat menu items become a parent submenu:

```
Right-click on page:
  Birdbrain                           ← parent (contexts: ['page'])
  ├── Capture Full Page               ← static full-page stitch
  └── Capture Full Page (Scrolling)   ← scroll-to-load + stitch

Right-click on selected text:
  Create Selector from Selection      ← unchanged (contexts: ['selection'])
```

All "Birdbrain" children are disabled when not connected or no active case. The selector item stays independent.

### Capture modes

**"Capture Full Page" (non-scrolling)**

Same scroll-and-stitch algorithm as the existing implementation, but the 20,000px `maxHeight` cap is replaced with a 100 MB raw byte budget:

- After each viewport slice is captured, accumulate `viewportWidth × viewportHeight × 4 × dpr²` bytes
- Stop stitching when the byte budget is exceeded or `scrollHeight` is fully captured
- No time limit — the page height is finite and already loaded
- Sticky/fixed element handling unchanged

**"Capture Full Page (Scrolling)"**

Two-phase capture for pages with lazy-loaded or infinite-scroll content:

1. **Scroll phase** — scroll the page downward in viewport-height increments, pausing 500ms between scrolls to let content render. Guards:
   - **Time limit:** 120 seconds maximum for the scroll phase
   - **Stall detection:** stop if `scrollHeight` is unchanged after 3 consecutive scroll attempts (page reached its end)

2. **Capture phase** — scroll back to top and run the same progressive byte-budget stitch (100 MB cap)

### Existing triggers unchanged

- Toolbar button / manual capture → non-scrolling full-page (`CAPTURE_FULL_PAGE`)
- Selector match → non-scrolling full-page (`CAPTURE_FULL_PAGE`)
- Auto-capture → viewport-only via `captureScreenshot()` (no change)

## Messages

| Direction | Type | Payload | Response |
|---|---|---|---|
| Background → Content | `CAPTURE_FULL_PAGE` | `{ maxBytes: 104857600 }` | `{ screenshot: dataUrl }` or `{ error: string }` |
| Background → Content | `CAPTURE_FULL_PAGE_SCROLLING` | `{ maxBytes: 104857600, scrollTimeoutMs: 120000 }` | `{ screenshot: dataUrl }` or `{ error: string }` |
| Content → Background | `REQUEST_VIEWPORT_CAPTURE` | _(unchanged)_ | `{ dataUrl: string }` |

### Constants

```
CAPTURE_MAX_BYTES = 100 * 1024 * 1024       // 100 MB raw bitmap budget
SCROLL_TIMEOUT_MS = 120 * 1000               // 120 seconds for scroll phase
SCROLL_PAUSE_MS = 500                        // pause between scrolls for lazy-load
SCROLL_STALL_THRESHOLD = 3                   // stop scrolling if height unchanged 3 times
```

## Files to modify

| File | Change |
|---|---|
| `extension/src/background.ts` | Restructure context menu to parent + 2 children, add `captureScrollingPageScreenshot()` orchestrator, update `captureFullPageScreenshot()` to send `maxBytes` instead of `maxHeight`, route click handler for new menu items, update enable/disable for 3 items |
| `extension/src/content.ts` | Modify `captureFullPage()` to use byte budget instead of height cap, add `captureFullPageScrolling()` with scroll-to-load + stitch phases, add `CAPTURE_FULL_PAGE_SCROLLING` message handler |
| `src/main/services/captureServer.ts` | Raise `MAX_SCREENSHOT_SIZE` from 10 MB to 100 MB |

## Acceptance criteria

1. Right-clicking a page shows "Birdbrain" → "Capture Full Page" and "Capture Full Page (Scrolling)"
2. "Capture Full Page" captures the entire loaded page height without a pixel cap, stopping at the 100 MB byte budget
3. "Capture Full Page (Scrolling)" scrolls the page to load new content, stops after 120s or stall detection, then stitches the full result
4. Both modes produce a valid PNG that the Birdbrain server accepts and stores
5. Existing toolbar/selector/auto captures behave identically to before (non-scrolling full-page for manual/selector, viewport for auto)
6. All context menu items are disabled when not connected or no active case
7. Scroll position is restored after both capture modes
8. Sticky/fixed element handling continues to work correctly

## Testing

Manual testing against:
- A long but finite page (e.g. Wikipedia article) → "Capture Full Page" captures the entire page
- An infinite-scroll page (e.g. social media feed) → "Capture Full Page (Scrolling)" scrolls and captures, stops within 120s
- A short page → both modes produce results identical to current behavior
- Disconnected state → all Birdbrain menu items are disabled
- Very large page → capture stops at byte budget, no OOM or crash
