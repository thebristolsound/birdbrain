# Settings Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all Capture & Storage settings actually work — remove 2 dead settings (`captureHtml`, `maxStorageMb`) and wire up 2 ignored settings (`dedupeWindowSeconds`, `storagePath`).

**Architecture:** Four independent changes touching the settings type, the capture server, the Chrome extension, the main process startup, and the settings UI. Each task is self-contained and can be committed independently.

**Tech Stack:** TypeScript, Electron, Hono (capture server), Chrome Extension APIs, React, Vitest

---

### Task 1: Remove `captureHtml` setting

**Files:**
- Modify: `src/shared/types.ts:57` — remove property
- Modify: `src/main/services/settings.ts:11` — remove from DEFAULT_SETTINGS
- Modify: `src/renderer/components/settings/CapturePreferences.tsx:41-49` — remove toggle
- Modify: `tests/main/services/settings.test.ts:33` — remove assertion

- [ ] **Step 1: Remove `captureHtml` from `BirdbrainSettings` interface**

In `src/shared/types.ts`, remove line 57:

```ts
// REMOVE this line:
  captureHtml: boolean
```

The interface should go from:

```ts
export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  captureHtml: boolean
  dedupeWindowSeconds: number
```

To:

```ts
export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  dedupeWindowSeconds: number
```

- [ ] **Step 2: Remove `captureHtml` from `DEFAULT_SETTINGS`**

In `src/main/services/settings.ts`, remove line 11:

```ts
// REMOVE this line:
  captureHtml: true,
```

- [ ] **Step 3: Remove the "Capture HTML" toggle from CapturePreferences**

In `src/renderer/components/settings/CapturePreferences.tsx`, remove lines 41-49 (the entire `<label>` block for captureHtml):

```tsx
// REMOVE this entire block:
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.captureHtml}
            onChange={(e) => onUpdate({ captureHtml: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm text-text-secondary">Capture HTML</span>
        </label>
```

- [ ] **Step 4: Remove test assertion for `captureHtml`**

In `tests/main/services/settings.test.ts`, in the test "returns default settings when no file exists" (line 33), remove:

```ts
// REMOVE this line:
    expect(settings.captureHtml).toBe(true)
```

- [ ] **Step 5: Run tests to verify nothing breaks**

Run: `pnpm test`
Expected: All tests pass. TypeScript compilation succeeds (no remaining references to `captureHtml`).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/services/settings.ts src/renderer/components/settings/CapturePreferences.tsx tests/main/services/settings.test.ts
git commit -m "fix: remove dead captureHtml setting

The captureHtml boolean was never read by the capture pipeline. Since
the app exclusively uses MHTML format, this toggle was meaningless.

Matt Donovan <mattddonovan@proton.me"
```

---

### Task 2: Remove `maxStorageMb` setting

**Files:**
- Modify: `src/shared/types.ts:61` — remove property
- Modify: `src/main/services/settings.ts:15` — remove from DEFAULT_SETTINGS
- Modify: `src/renderer/components/settings/StorageConfig.tsx:21-34` — remove input field

- [ ] **Step 1: Remove `maxStorageMb` from `BirdbrainSettings` interface**

In `src/shared/types.ts`, remove the line (after Task 1 this will be around line 60):

```ts
// REMOVE this line:
  maxStorageMb: number | null
```

- [ ] **Step 2: Remove `maxStorageMb` from `DEFAULT_SETTINGS`**

In `src/main/services/settings.ts`, remove the line:

```ts
// REMOVE this line:
  maxStorageMb: null,
```

- [ ] **Step 3: Remove the Max Storage input from StorageConfig**

In `src/renderer/components/settings/StorageConfig.tsx`, remove the entire max storage `<div>` block (lines 21-34):

```tsx
// REMOVE this entire block:
        <div>
          <label className="mb-1 block text-sm text-text-muted">
            Max Storage (MB) — leave empty for unlimited
          </label>
          <input
            type="number"
            value={settings.maxStorageMb ?? ''}
            onChange={(e) =>
              onUpdate({ maxStorageMb: e.target.value ? parseInt(e.target.value) : null })
            }
            className="w-32 rounded border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            placeholder="Unlimited"
            min={0}
          />
        </div>
```

- [ ] **Step 4: Run tests to verify nothing breaks**

Run: `pnpm test`
Expected: All tests pass. No remaining TS references to `maxStorageMb`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/services/settings.ts src/renderer/components/settings/StorageConfig.tsx
git commit -m "fix: remove dead maxStorageMb setting

Storage cap enforcement was never implemented and is not desired.
Remove the setting from types, defaults, and UI.

Matt Donovan <mattddonovan@proton.me"
```

---

### Task 3: Enforce `dedupeWindowSeconds` in extension

**Files:**
- Modify: `src/main/services/captureServer.ts:158-167` — add to status response
- Modify: `extension/src/utils/api.ts:13-22` — add to StatusResponse type
- Modify: `extension/src/background.ts:121` — make dedupe window dynamic
- Modify: `extension/src/background.ts:164` — read setting from status
- Modify: `extension/src/background.ts:402,410` — use dynamic value
- Modify: `tests/main/services/captureServer.test.ts:333-345` — add assertion

- [ ] **Step 1: Add `dedupeWindowSeconds` to the `/api/status` response**

In `src/main/services/captureServer.ts`, in the status endpoint response object (around line 158), add `dedupeWindowSeconds` after `captureScreenshots`:

Change the return statement from:

```ts
    return c.json({
      running: true,
      activeCase: activeCase ? { id: activeCase.id, name: activeCase.name } : null,
      sessionActive: state.sessionActive,
      captureCount: state.captureCount,
      autoCaptureMode: settings.autoCaptureMode,
      cases: includeCases && allCases ? allCases.map((cs) => ({ id: cs.id, name: cs.name })) : [],
      ignoredUrlPatterns: settings.ignoredUrlPatterns,
      captureScreenshots: settings.captureScreenshots
    })
```

To:

```ts
    return c.json({
      running: true,
      activeCase: activeCase ? { id: activeCase.id, name: activeCase.name } : null,
      sessionActive: state.sessionActive,
      captureCount: state.captureCount,
      autoCaptureMode: settings.autoCaptureMode,
      cases: includeCases && allCases ? allCases.map((cs) => ({ id: cs.id, name: cs.name })) : [],
      ignoredUrlPatterns: settings.ignoredUrlPatterns,
      captureScreenshots: settings.captureScreenshots,
      dedupeWindowSeconds: settings.dedupeWindowSeconds
    })
```

- [ ] **Step 2: Add `dedupeWindowSeconds` to the extension's `StatusResponse` type**

In `extension/src/utils/api.ts`, add to the `StatusResponse` interface (after line 21):

```ts
interface StatusResponse {
  running: boolean
  activeCase: { id: string; name: string } | null
  sessionActive: boolean
  captureCount: number
  autoCaptureMode?: string
  cases?: Array<{ id: string; name: string }>
  ignoredUrlPatterns?: string[]
  captureScreenshots?: boolean
  dedupeWindowSeconds?: number
}
```

- [ ] **Step 3: Make the extension's dedupe window dynamic**

In `extension/src/background.ts`, change line 121 from a constant to a mutable variable:

```ts
// CHANGE:
const DEDUPE_WINDOW_MS = 60_000
// TO:
let dedupeWindowMs = 60_000
```

- [ ] **Step 4: Read `dedupeWindowSeconds` from status in `checkStatus()`**

In `extension/src/background.ts`, in the `checkStatus()` function, after line 168 (`captureScreenshotsEnabled = status.captureScreenshots !== false`), add:

```ts
    dedupeWindowMs = (status.dedupeWindowSeconds || 60) * 1000
```

- [ ] **Step 5: Use `dedupeWindowMs` in `shouldCapture()` and `shouldSelectorCapture()`**

In `extension/src/background.ts`, in `shouldCapture()` (around line 402), change:

```ts
// CHANGE:
  if (lastCapture && Date.now() - lastCapture < DEDUPE_WINDOW_MS) return false
// TO:
  if (lastCapture && Date.now() - lastCapture < dedupeWindowMs) return false
```

In `shouldSelectorCapture()` (around line 410), change:

```ts
// CHANGE:
  if (last && Date.now() - last < DEDUPE_WINDOW_MS) return false
// TO:
  if (last && Date.now() - last < dedupeWindowMs) return false
```

- [ ] **Step 6: Add test for `dedupeWindowSeconds` in status response**

In `tests/main/services/captureServer.test.ts`, in the existing test "GET /api/status returns cases and ignoredUrlPatterns" (line 333), add an assertion after the `captureScreenshots` check (line 344):

```ts
    expect(data.dedupeWindowSeconds).toBe(60)
```

- [ ] **Step 7: Run tests and build extension**

Run: `pnpm test`
Expected: All tests pass, including the new assertion.

Run: `pnpm build:extension`
Expected: Extension builds without errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/captureServer.ts extension/src/utils/api.ts extension/src/background.ts tests/main/services/captureServer.test.ts
git commit -m "fix: enforce dedupeWindowSeconds setting in extension

The dedupeWindowSeconds setting was configurable in the UI but the
extension hardcoded 60s. Now the extension reads the setting from
/api/status and uses it for auto-capture and selector deduplication.

Matt Donovan <mattddonovan@proton.me"
```

---

### Task 4: Enforce `storagePath` at app boot

**Files:**
- Modify: `src/main/index.ts:51-57` — read storagePath from settings

- [ ] **Step 1: Use `storagePath` setting in app initialization**

In `src/main/index.ts`, add import for `getSettings` and change the `initStorage` call. Replace the existing initialization block (lines 51-57):

```ts
app.whenReady().then(async () => {
  // Initialize database
  const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
  initDatabase(join(userDataPath, 'birdbrain.db'))
  initStorage(join(userDataPath, 'captures'))
  initSettings(userDataPath)
  initInstallationId(userDataPath)
```

With:

```ts
app.whenReady().then(async () => {
  // Initialize database
  const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
  initDatabase(join(userDataPath, 'birdbrain.db'))
  initSettings(userDataPath)
  initInstallationId(userDataPath)

  // Use storagePath from settings, fall back to default if empty or unwritable
  const settings = getSettings()
  const defaultCapturesDir = join(userDataPath, 'captures')
  let capturesDir = settings.storagePath || defaultCapturesDir
  try {
    initStorage(capturesDir)
  } catch (err) {
    console.warn(`Failed to initialize storage at "${capturesDir}", falling back to default:`, err)
    capturesDir = defaultCapturesDir
    initStorage(capturesDir)
  }
```

Note: `initSettings` must be called **before** `getSettings()`, so it moves before `initStorage`. Add `getSettings` to the import from `@main/services/settings`:

```ts
import { initSettings, getSettings } from '@main/services/settings'
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `pnpm test`
Expected: All tests pass. The startup order change (initSettings before initStorage) is safe since they don't depend on each other.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "fix: honor storagePath setting at app startup

Previously initStorage always used the hardcoded default path.
Now it reads storagePath from settings, with fallback to default
if the configured path is unwritable.

Matt Donovan <mattddonovan@proton.me"
```

---

### Task 5: Add storage path file picker IPC channel

**Files:**
- Modify: `src/shared/ipc.ts:43-48` — add new channel constant
- Modify: `src/main/ipcHandlers.ts:539-544` — register handler
- Modify: `src/preload/index.ts:164-175` — expose via bridge

- [ ] **Step 1: Add the IPC channel constant**

In `src/shared/ipc.ts`, add a new channel in the Settings section (after line 48, `SETTINGS_GET_IDENTITY`):

```ts
  SETTINGS_CHOOSE_STORAGE_PATH: 'settings:chooseStoragePath',
```

- [ ] **Step 2: Register the handler in ipcHandlers.ts**

In `src/main/ipcHandlers.ts`, after the settings handlers section (after the `SETTINGS_GET_IDENTITY` handler), add:

```ts
  ipcMain.handle(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH, async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose Storage Location'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
```

Note: Check the existing imports at the top of `ipcHandlers.ts` to see if `dialog` is already imported. If not, the dynamic import above handles it. If `electron` is already imported, use the static import instead.

- [ ] **Step 3: Expose the new channel in the preload bridge**

In `src/preload/index.ts`, in the `settings` object (after the `getIdentity` method, around line 174), add:

```ts
    chooseStoragePath: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH),
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `pnpm build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts
git commit -m "feat: add settings:chooseStoragePath IPC channel

Adds a file picker dialog for choosing a custom storage directory.
Returns the selected path or null if cancelled.

Matt Donovan <mattddonovan@proton.me"
```

---

### Task 6: Update StorageConfig UI with file picker and restart banner

**Files:**
- Modify: `src/renderer/components/settings/StorageConfig.tsx` — full rewrite

- [ ] **Step 1: Rewrite StorageConfig with Browse button and restart banner**

Replace the entire content of `src/renderer/components/settings/StorageConfig.tsx` with:

```tsx
import { useState } from 'react'
import type { BirdbrainSettings } from '@shared/types'

interface StorageConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function StorageConfig({ settings, onUpdate }: StorageConfigProps) {
  const [restartNeeded, setRestartNeeded] = useState(false)

  const handleBrowse = async () => {
    const path = await window.birdbrain.settings.chooseStoragePath()
    if (path) {
      await onUpdate({ storagePath: path })
      setRestartNeeded(true)
    }
  }

  const handleReset = async () => {
    await onUpdate({ storagePath: '' })
    setRestartNeeded(true)
  }

  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Storage</h2>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-text-muted">Storage Location</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded bg-elevated px-3 py-2 font-mono text-sm text-text-muted">
              {settings.storagePath || 'Default'}
            </div>
            <button
              onClick={handleBrowse}
              className="rounded bg-elevated px-3 py-2 text-sm text-text-secondary hover:bg-surface"
            >
              Browse...
            </button>
            {settings.storagePath && (
              <button
                onClick={handleReset}
                className="rounded bg-elevated px-3 py-2 text-sm text-text-muted hover:text-red-400"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {restartNeeded && (
          <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-400">
            Restart required for storage location change to take effect.
          </div>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Check `window.birdbrain` type declarations**

Verify that the preload type declarations include the new `chooseStoragePath` method. Check if a `.d.ts` file declares the `window.birdbrain` type (likely in `src/preload/` or `src/renderer/`). If so, add the method there too. If no explicit type declarations exist (preload inferred types), this step is a no-op.

Run: `pnpm build`
Expected: Build succeeds. StorageConfig renders the Browse button and restart banner.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/StorageConfig.tsx
git commit -m "feat: add file picker and restart banner to StorageConfig

Browse button opens native directory picker. Restart-required banner
shows when storage path changes. Reset button returns to default.

Matt Donovan <mattddonovan@proton.me"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 2: Build extension**

Run: `pnpm build:extension`
Expected: Extension compiles without errors.

- [ ] **Step 3: Build Electron app**

Run: `pnpm build`
Expected: Full build succeeds.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: No lint errors.

- [ ] **Step 5: Manual smoke test checklist**

1. Start app with `pnpm dev`
2. Open Settings > Capture Preferences:
   - Verify "Capture HTML" toggle is gone
   - Verify dedupe slider still works
3. Open Settings > Storage:
   - Verify "Max Storage" input is gone
   - Verify "Browse..." button appears
   - Click Browse, select a directory, verify restart banner appears
4. In the Chrome extension, verify auto-capture deduplication respects the slider value (change to 0s, verify rapid re-captures work; change to 300s, verify dedup blocks)
