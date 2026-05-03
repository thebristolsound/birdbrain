# Settings Enforcement: Capture & Storage Pipeline Audit Fix

**Date:** 2026-04-09
**Status:** Approved

## Problem

An audit of the Capture and Storage settings revealed that several settings displayed in the UI have no effect on the capture pipeline:

| Setting | Status | Resolution |
|---|---|---|
| `captureHtml` | Dead — never read by pipeline | **Remove** |
| `maxStorageMb` | Dead — never enforced | **Remove** |
| `dedupeWindowSeconds` | Dead — extension hardcodes 60s | **Enforce** |
| `storagePath` | Dead — `initStorage()` ignores it | **Enforce** |

Settings that already work correctly and require no changes: `captureScreenshots`, `ignoredUrlPatterns`, `autoCaptureMode`, `operatorName`.

## 1. Remove `captureHtml`

Since the app exclusively uses MHTML format, the `captureHtml` boolean is meaningless.

**Files to modify:**
- `src/shared/types.ts` — Remove `captureHtml` from `BirdbrainSettings`
- `src/main/services/settings.ts` — Remove from `DEFAULT_SETTINGS`
- `src/renderer/components/settings/CapturePreferences.tsx` — Remove the toggle
- `tests/main/services/settings.test.ts` — Remove assertions referencing `captureHtml`

## 2. Remove `maxStorageMb`

Storage cap enforcement was never implemented and is not desired.

**Files to modify:**
- `src/shared/types.ts` — Remove `maxStorageMb` from `BirdbrainSettings`
- `src/main/services/settings.ts` — Remove from `DEFAULT_SETTINGS`
- `src/renderer/components/settings/StorageConfig.tsx` — Remove the input field
- `tests/main/services/settings.test.ts` — Remove assertions referencing `maxStorageMb`

## 3. Enforce `dedupeWindowSeconds`

The user-configurable dedupe window (default: 60s) must control the extension's auto-capture deduplication. The server's manual-capture dedupe (5s double-click guard) stays hardcoded.

### Data flow

```
Settings UI → settings.json → capture server /api/status → extension polls → extension uses dynamic value
```

### Changes

**`src/main/services/captureServer.ts`:**
- In the `/api/status` handler, add `dedupeWindowSeconds: settings.dedupeWindowSeconds` to the response JSON

**`extension/src/utils/api.ts`:**
- Add `dedupeWindowSeconds?: number` to the status response type

**`extension/src/background.ts`:**
- Change `const DEDUPE_WINDOW_MS = 60_000` to `let dedupeWindowMs = 60_000`
- In `checkStatus()`, read the setting: `dedupeWindowMs = (status.dedupeWindowSeconds ?? 60) * 1000`
- In `shouldCapture()`, use `dedupeWindowMs` instead of `DEDUPE_WINDOW_MS`
- In `shouldSelectorCapture()`, use `dedupeWindowMs` instead of `DEDUPE_WINDOW_MS`

### Not changed

- `MANUAL_DEDUPE_WINDOW_MS = 5_000` in `captureServer.ts` stays hardcoded — it's a server-side double-click guard for manual captures, not a user preference.

## 4. Enforce `storagePath` with file picker

The `storagePath` setting must be read at app startup and used as the storage root. Changes require an app restart.

### Changes

**`src/main/index.ts`:**
- After `initSettings(userDataPath)`, read settings and use `storagePath`:
  ```ts
  const settings = getSettings()
  const capturesDir = settings.storagePath || join(userDataPath, 'captures')
  initStorage(capturesDir)
  ```
- Wrap `initStorage` in try/catch: if the configured path is unwritable, fall back to default and log a warning

**`src/shared/ipc.ts`:**
- Add new channel: `settings:chooseStoragePath` — invokes `dialog.showOpenDialog` and returns the selected directory path

**`src/main/ipcHandlers.ts`:**
- Register the new `settings:chooseStoragePath` handler using Electron's `dialog.showOpenDialog({ properties: ['openDirectory'] })`


**`src/preload/index.ts`:**
- Expose the new channel via `window.birdbrain`

**`src/renderer/components/settings/StorageConfig.tsx`:**
- Add a "Browse..." button that invokes the new IPC channel
- When the path changes, show a "Restart required for changes to take effect" banner
- Display the current active storage path (read from settings)

### Edge cases

- If `storagePath` is empty string or not set, fall back to `join(userDataPath, 'captures')` (current behavior)
- If the configured path doesn't exist, `initStorage` creates it (`mkdirSync` with `recursive: true`)
- If the configured path is unwritable, fall back to default with console warning

## Testing

- Update existing settings tests to remove `captureHtml` and `maxStorageMb` assertions
- Add a test verifying `dedupeWindowSeconds` appears in `/api/status` response
- Add a test verifying `storagePath` is used by `initStorage` when set
- Verify extension build still compiles after `background.ts` changes

## Migration

Existing `settings.json` files may contain `captureHtml` and `maxStorageMb` keys. These are harmless — `getSettings()` uses spread (`{ ...DEFAULT_SETTINGS, ...saved }`) so unknown keys are silently carried forward. No migration needed.
