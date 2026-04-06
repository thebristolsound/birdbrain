# Capture Regression Fixes

**Date:** 2026-04-06
**Status:** Approved

## Problem

The MHTML forensic capture migration (PR #55, commits `60a2446`-`9ea6ea9`) introduced three regressions:

1. **Screenshots no longer captured** — All `chrome.tabs.captureVisibleTab()` calls were removed when switching to MHTML. The DB column `screenshot_path`, storage functions (`getThumbnail`), and viewer UI ("Screenshot" tab) still exist but nothing produces screenshots.

2. **Text content shows as empty in viewer** — `getPlainTextFromTab()` still runs and text is stored in FTS for search, but `ingestMhtmlCapture()` never writes a `.txt` file to disk. The CaptureViewer's "Text" tab reads `.txt` files via `getContent(id, 'txt')`, so it always shows "No text content available."

3. **Selector highlighting doesn't appear until page refresh** — The old manual capture flow involved the content script (via `EXTRACT_PAGE`), keeping the DOM context active and triggering re-evaluation. The new `manualCaptureTab()` bypasses the content script entirely (uses `chrome.pageCapture.saveAsMHTML()` + `chrome.scripting.executeScript`), so `checkSelectorsOnTab()` is never called after a manual capture.

## Design

### Fix 1: Re-add screenshot capture to MHTML flow

**Extension side (`extension/src/background.ts`):**
- Add `chrome.tabs.captureVisibleTab(tabId, { format: 'png' })` to the `Promise.all` in all three capture functions: `captureTab()`, `manualCaptureTab()`, `handleSelectorCapture()`
- Convert the returned data URL to a `Blob`
- Pass the screenshot blob to `sendMhtmlCapture()`

**API layer (`extension/src/utils/api.ts`):**
- Add optional `screenshot?: Blob` parameter to `sendMhtmlCapture()`
- Append to FormData as `form.append('screenshot', params.screenshot, 'screenshot.png')` when present

**Server (`src/main/services/captureServer.ts`):**
- Extract `screenshot` file from the parsed FormData body
- Convert to `Buffer` and pass to `ingestMhtmlCapture()` as optional `screenshot` parameter

**Ingest pipeline (`src/main/services/mhtmlIngest.ts`):**
- Accept optional `screenshot: Buffer` in `IngestParams`
- After writing the MHTML file, write screenshot to `{captureId}.png` in the case directory
- Pass `screenshotPath` to `db.insertCapture()` (the column already exists)
- Existing `getThumbnail()` in `storage.ts` will auto-generate thumbnails from the `.png`

### Fix 2: Write text content to disk during MHTML ingest

**Single file change in `src/main/services/mhtmlIngest.ts`:**
- After writing the MHTML file, if `textContent` is non-empty, write it to `{captureId}.txt` in the case directory using `writeFileSync()`
- The CaptureViewer already requests `.txt` files via `getContent(id, 'txt')`, so the text tab works immediately

### Fix 3: Trigger selector highlighting after manual capture

**Single file change in `extension/src/background.ts`:**
- In `manualCaptureTab()`, after the success toast is sent, call `checkSelectorsOnTab(tabId, url)` to trigger selector matching and DOM highlighting
- This ensures selectors are re-evaluated and highlights rendered after every manual capture, matching the old behavior

## Files changed

| File | Changes |
|------|---------|
| `extension/src/background.ts` | Add `captureVisibleTab` to 3 capture functions; add `checkSelectorsOnTab` after manual capture |
| `extension/src/utils/api.ts` | Add `screenshot` param to `sendMhtmlCapture` |
| `src/main/services/captureServer.ts` | Extract screenshot from FormData, pass to ingest |
| `src/main/services/mhtmlIngest.ts` | Write screenshot `.png` and text `.txt` to disk |

## Non-goals

- No changes to the manifest chain or hash verification (screenshots are supplementary, not forensically chained)
- No changes to the database schema (existing `screenshot_path` column is sufficient)
- No changes to the CaptureViewer UI (it already handles screenshots and text)
