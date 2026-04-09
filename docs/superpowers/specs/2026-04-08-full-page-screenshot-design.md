# Full-Page Screenshot Capture

## Summary

Replace the existing viewport-only screenshot (`captureVisibleTab`) with a full-page scroll-and-stitch capture for manual and selector-triggered captures. Auto-captures remain viewport-only to avoid disrupting the user's browsing. The existing `captureScreenshots` setting (currently non-functional) will be wired up to actually control whether screenshots are taken.

## Requirements

- Full-page screenshots for manual and selector captures (opt-out via existing setting)
- Viewport-only screenshots for auto-captures (non-disruptive)
- Max height cap of 20,000px to prevent runaway captures on infinite-scroll pages
- Sticky/fixed element handling to avoid repetition across slices
- Scroll position restored after capture
- Graceful fallback to viewport capture when content script is unreachable
- No server-side changes required

## Approach: Content Script Scroll-and-Stitch

The content script scrolls the page incrementally, capturing each viewport slice via `chrome.tabs.captureVisibleTab()` from the background script, then stitches the slices into a single tall PNG using OffscreenCanvas.

### Capture Flow

**Decision tree per capture:**

1. Is `captureScreenshots` setting enabled? If no -> no screenshot at all
2. Is this an auto-capture? If yes -> viewport-only via `captureVisibleTab()`
3. Otherwise (manual/selector) -> full-page scroll capture via content script, with viewport fallback on error

**Full-page capture sequence:**

1. Background script sends `CAPTURE_FULL_PAGE` message to content script
2. Content script measures `document.documentElement.scrollHeight`, caps at 20,000px
3. Content script saves current scroll position
4. Content script hides sticky/fixed elements (except on first slice)
5. For each viewport-height slice:
   a. Scroll to offset `i * viewportHeight`
   b. Wait ~150ms for paint to settle
   c. Send `REQUEST_VIEWPORT_CAPTURE` to background
   d. Background calls `captureVisibleTab()`, returns data URL
   e. Content script stores the slice
6. Restore sticky/fixed elements
7. Restore original scroll position
8. Draw all slices onto OffscreenCanvas(`viewportWidth`, `totalHeight`)
9. Last slice clipped to `totalHeight - lastSliceOffset` to avoid duplication
10. Export canvas as PNG data URL, return to background
11. Background converts to blob and includes in FormData `screenshot` field

**Fallback:** If content script is unreachable (chrome:// pages, PDFs, extension pages), background falls back to single `captureVisibleTab()` call.

### Message Protocol

| Direction | Message Type | Payload | Response |
|-----------|-------------|---------|----------|
| Background -> Content | `CAPTURE_FULL_PAGE` | `{ maxHeight: 20000 }` | `{ screenshot: dataUrl }` or `{ error: string }` |
| Content -> Background | `REQUEST_VIEWPORT_CAPTURE` | `{}` | `{ dataUrl: string }` |

### Sticky Element Handling

Before scrolling, the content script queries elements with `position: fixed` or `position: sticky` and temporarily sets them to `position: relative`. On the first slice, sticky elements are left as-is so headers appear at the top of the capture. All elements are restored after capture completes.

### Edge Cases

- **Pages shorter than viewport:** Single slice captured, effectively identical to current viewport capture
- **Last slice overlap:** Canvas clips the final slice to remaining height to prevent duplication
- **Content script injection failure:** Background catches the error and falls back to `captureVisibleTab()`
- **Dynamic content during scroll:** Accepted limitation; minor visual discontinuities possible

## Settings Integration

### Current State

`captureScreenshots: boolean` exists in `BirdbrainSettings` (defaults `true`) and renders as a toggle in CapturePreferences, but is never sent to the extension. The extension always captures screenshots regardless.

### Changes

1. **`/api/status` endpoint** (`captureServer.ts`) - Add `captureScreenshots: boolean` to response JSON
2. **`StatusResponse` interface** (`extension/src/utils/api.ts`) - Add `captureScreenshots` field
3. **Background `checkStatus()`** - Read new field into module-level variable (defaults `true`)
4. **All three capture paths** - Check `captureScreenshots` before calling screenshot function; pass `undefined` if disabled
5. **No new settings UI** - Existing toggle now actually works

### Capture Mode by Source

| Capture Source | Screenshot Mode | Reason |
|---------------|----------------|--------|
| Auto | Viewport only (`captureVisibleTab`) | Non-disruptive while user browses |
| Manual | Full-page scroll capture | User explicitly triggered, expects thoroughness |
| Selector | Full-page scroll capture | Automated but targeted, content matters |

## Files Changed

### Extension

- `extension/src/background.ts` - New `captureFullPage()` orchestration, `REQUEST_VIEWPORT_CAPTURE` handler, `captureScreenshots` variable from status, conditional screenshot logic in all 3 capture paths
- `extension/src/content.ts` - New `CAPTURE_FULL_PAGE` handler with scroll-stitch algorithm, sticky element management
- `extension/src/utils/api.ts` - Add `captureScreenshots` to `StatusResponse`

### Main Process

- `src/main/services/captureServer.ts` - Add `captureScreenshots` to `/api/status` response

### No Changes Needed

- `src/shared/types.ts` - `BirdbrainSettings.captureScreenshots` already exists
- `src/main/services/settings.ts` - Default already `true`
- `src/main/services/mhtmlIngest.ts` - Already handles optional screenshot buffer
- `src/renderer/components/settings/CapturePreferences.tsx` - Toggle already exists

## Acceptance Criteria

1. **Full-page capture on manual capture** - When a user triggers a manual capture, the saved PNG contains the full page content (not just the viewport), up to the 20,000px height cap
2. **Full-page capture on selector capture** - Selector-triggered captures also produce full-page screenshots
3. **Auto-capture stays viewport-only** - Auto-captures use `captureVisibleTab()` only, no page scrolling occurs
4. **`captureScreenshots` setting is respected** - When toggled off in Settings > Capture Preferences, no screenshot is captured for any source (auto, manual, or selector). When toggled on (default), screenshots are captured
5. **Setting is communicated to extension** - `/api/status` includes `captureScreenshots` in its response, and the extension reads it during `checkStatus()` polling
6. **Height cap enforced** - Pages taller than 20,000px are captured only up to that limit
7. **Scroll position restored** - After a full-page capture, the page returns to the user's original scroll position
8. **Sticky/fixed elements handled** - Fixed-position elements (headers, navbars) don't repeat across every slice
9. **Graceful fallback** - If the content script is unreachable (chrome:// pages, PDFs, extension pages), falls back to viewport-only capture without error
10. **No server changes required** - The existing `screenshot` FormData field and PNG storage pipeline work unchanged

## Testing

- Unit tests for height calculation and slice logic (pure functions)
- Manual testing on: short page, long article, infinite-scroll page, page with sticky header, chrome:// page
