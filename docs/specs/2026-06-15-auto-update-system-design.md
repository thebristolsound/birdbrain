# Auto-Update System — Design

**Date:** 2026-06-15
**Status:** Approved design, pending implementation plan
**Author:** Matt Donovan

## Summary

Birdbrain currently has no in-app update mechanism. Releases are cut by pushing a
`v*` git tag, which builds installers (Windows NSIS `.exe`, macOS `.dmg`, Linux
AppImage + `.deb`) and uploads them to a GitHub Release via
`softprops/action-gh-release`. Users update by manually re-downloading.

This design adds an in-app auto-update system modelled on T3 Code
(`pingdotgg/t3code`): `electron-updater` against GitHub Releases, with a polished
in-app surface (a context-aware control in **Settings → About** plus a dismissible
**TopBar pill**), update state synced into the React Query cache via a main→renderer
event stream, and channel auto-matching (a beta build updates to newer betas, a
stable build to stable only).

## Decisions

These were settled during brainstorming and are fixed for this iteration:

1. **Platforms:** Real in-app update on **Windows (NSIS)** and **Linux (AppImage)**
   now — neither requires a code-signing cert. macOS is **wired but inactive**
   (auto-update requires Apple Developer ID + notarization, which is a separate
   task) and `.deb` cannot auto-update (updates flow through apt). On those
   unsupported targets the UI degrades to a "Download <version>" link to the
   GitHub release page.
2. **Update flow:** **Notify-only, manual steps.** The app checks automatically and
   tells the user an update exists, but the user explicitly clicks Download, then
   explicitly clicks Install. Nothing downloads or installs silently.
3. **UI surface:** **Settings → About** (context-aware Check / Download / Install)
   **plus a dismissible TopBar pill** when an update is available or downloaded.
4. **Channels:** **Auto-match the running build's channel.** Derived from
   `app.getVersion()`: a prerelease build (`-beta`, `-alpha`) sets
   `allowPrerelease = true` (sees newer betas and stable); a stable build ignores
   prereleases. No user-facing channel toggle.
5. **Feed/host:** **GitHub Releases** (`provider: github`). The repo is public and
   already the distribution channel.

## Approach

**Chosen:** `electron-updater` + GitHub Releases provider, with a lightweight
"open the release page in the browser" fallback for unsupported targets
(macOS unsigned, `.deb`).

Alternatives considered and rejected:

- **Self-hosted / S3 generic feed** — hosting and ops overhead with no benefit for
  an OSS app already publishing to GitHub Releases.
- **Custom "check latest release → open browser" as the primary path** — not a real
  in-app update. Reused only as the fallback for unsupported targets.

## Architecture

```
electron-updater (main) ──events──▶ updater service ──▶ broadcast event:update:state
        │                                                        │
   GitHub Releases                                               ▼
   latest.yml / *.blockmap                          preload: window.birdbrain.updates
                                                                 │
                                          ┌──────────────────────┴───────────────┐
                                          ▼                                       ▼
                              React Query cache ['updates','state']      mutations: check / download / install
                                          │
                            ┌─────────────┴─────────────┐
                            ▼                           ▼
                   TopBar <UpdatePill>          Settings→About <UpdateSection>
```

Data flow: the main-process updater service owns all `electron-updater` interaction,
reduces its events into a single `UpdateState`, caches the latest snapshot, and
broadcasts every change on `event:update:state`. The renderer seeds a React Query
query from `updates:getState` and writes each broadcast into the same query cache,
so every component reads one source of truth. User actions (check / download /
install) are React Query mutations that call typed IPC.

## Components

### 1. Main — `src/main/services/updater.ts` (new)

Wraps `electron-updater`'s `autoUpdater`. Note the ESM-interop workaround required
because the main bundle is produced by electron-vite:

```ts
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
```

Configuration:

- `autoUpdater.autoDownload = false` — notify-only; download is user-initiated.
- `autoUpdater.autoInstallOnAppQuit = false` — nothing installs silently on quit;
  install is explicit.
- `autoUpdater.allowPrerelease = isPrerelease(app.getVersion())` — channel
  auto-match.

Responsibilities:

- Register `electron-updater` event handlers (`checking-for-update`,
  `update-available`, `update-not-available`, `download-progress`,
  `update-downloaded`, `error`), map each to an `UpdateState`, cache the latest, and
  broadcast on `event:update:state`.
- Expose `check()`, `download()`, `install()`, `getState()` consumed by the IPC
  handlers.
- **Guard activation:** only run when `app.isPackaged` **and** the platform is
  supported — `win32`, or Linux launched as an AppImage (detected via the
  `APPIMAGE` env var). Otherwise emit a one-shot `supported: false` state carrying
  the current version and a release-page URL; never touch `autoUpdater`.
- **Scheduling:** check once on launch (after a short delay so startup isn't
  blocked) and every 6 hours thereafter, gated by the
  `checkForUpdatesAutomatically` setting. Downloads never happen on a schedule.
- **Install path:** `install()` calls `autoUpdater.quitAndInstall()`. The
  confirmation prompt (and active-session warning) is handled in the renderer
  before this IPC is invoked.

Pure, unit-testable helpers split into a sibling module (e.g.
`src/main/services/updaterChannel.ts` or co-located, no Electron imports):

- `isPrerelease(version: string): boolean`
- `detectSupport(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean`
- `toUpdateState(...)` — the event→state reducer.

### 2. Shared — `src/shared/ipc.ts` and `src/shared/types.ts`

Add an `updates` domain to `IPC_CHANNELS`, following the existing
`DOMAIN_ACTION: 'domain:action'` and `event:` conventions:

```ts
// Updates
UPDATES_CHECK: 'updates:check',
UPDATES_DOWNLOAD: 'updates:download',
UPDATES_INSTALL: 'updates:install',
UPDATES_GET_STATE: 'updates:getState',

// Events (main -> renderer)
UPDATE_STATE: 'event:update:state',
```

Add the `UpdateState` type to `src/shared/types.ts`:

```ts
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'      // found; not downloading (notify-only)
  | 'not-available'
  | 'downloading'
  | 'downloaded'     // ready to install
  | 'error'

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  channel: 'stable' | 'beta'
  supported: boolean       // false on macOS (unsigned) / .deb → manual download
  progress?: UpdateProgress
  releaseNotes?: string
  releaseUrl?: string
  error?: string
}
```

### 3. Preload — `src/preload/index.ts`

Extend the typed `window.birdbrain` bridge with an `updates` namespace following the
existing invoke/on pattern:

- `updates.check(): Promise<UpdateState>`
- `updates.download(): Promise<UpdateState>`
- `updates.install(): Promise<void>`
- `updates.getState(): Promise<UpdateState>`
- `updates.onState(cb: (state: UpdateState) => void): () => void` — subscribes to
  `event:update:state`, returns an unsubscribe function.

### 4. Main — `src/main/ipcHandlers.ts`

Register handlers for the four invoke channels, delegating to the updater service.

### 5. Renderer

- **`src/renderer/hooks/useUpdateState.ts`** — React Query query keyed
  `['updates','state']`, `queryFn` calls `getState()`. A `useEffect` subscribes to
  `updates.onState` and writes each push into the cache via `setQueryData`. Returns
  the current `UpdateState`.
- **`src/renderer/lib/queries.ts`** — add `useUpdatesMutations` (check / download /
  install) following the existing domain mutation-hook convention. `install` is
  guarded by a confirmation step in the calling component.
- **`src/renderer/components/updates/UpdatePill.tsx`** (new) — dismissible pill
  rendered in the TopBar when `status` is `available` or `downloaded`. Clicking
  navigates to Settings → About (TanStack Router). Dismiss hides it until the next
  state change.
- **`src/renderer/components/updates/UpdateSection.tsx`** (new) — rendered inside
  the existing `settings/About.tsx`. Shows the version row and a context-aware
  control that cycles Check → Download (with progress) → "Restart to install",
  plus a "What's new" link (`releaseUrl`) and an error state. When
  `supported: false`, it shows a single "Download <availableVersion>" button
  linking to `releaseUrl`.
- **Integration points:** `src/renderer/components/layout/TopBar.tsx` mounts
  `UpdatePill`; `src/renderer/components/settings/About.tsx` mounts
  `UpdateSection`.
- **Install confirmation:** before invoking `updates.install()`, the component shows
  a confirm dialog. If `appStore.sessionActive` is true, the copy warns that an
  active capture session will be interrupted.

### 6. Settings

Add `checkForUpdatesAutomatically: boolean` (default `true`) to the settings
defaults in `src/main/services/settings.ts` and to the settings type. Surface a
toggle in the Settings UI (About or Appearance panel). The manual "Check now"
action is always available regardless of this setting.

## Build & release pipeline

- **`package.json` `build`:** add
  ```json
  "publish": { "provider": "github", "owner": "thebristolsound", "repo": "birdbrain" }
  ```
  This is what makes electron-builder emit `latest.yml`, `latest-linux.yml`, and
  `*.blockmap` next to the installers. Under `--publish never` the files are still
  generated; only the upload is skipped — so the existing pipeline is preserved.
- **`.github/workflows/release.yml`:** extend the upload globs for the Windows and
  Linux jobs to include the update metadata:
  - Windows: add `dist/latest.yml` and `dist/*.blockmap`.
  - Linux: add `dist/latest-linux.yml` and `dist/*.blockmap`.
  Keep `--publish never` and the `softprops/action-gh-release` upload steps as-is.
- **macOS:** unchanged for now (`.dmg` only). When signing/notarization lands, add a
  `zip` target to the mac build and upload `dist/latest-mac.yml` so mac auto-update
  can be activated. The renderer already handles `supported: false` until then.
- **Dependency:** add `electron-updater` as a runtime **dependency** (it ships
  inside the app, not a dev-only tool).
- **Local testing:** add a `dev-app-update.yml` and an optional small static
  **mock update server** script (mirroring T3 Code's `mock-update-server`) so the
  check → download → install flow can be exercised without cutting a real release.

### CI publishing: keep `action-gh-release`

We keep the current `--publish never` + `action-gh-release` flow rather than
switching to electron-builder's own GitHub publishing (`--publish always` with
`GH_TOKEN`). Rationale: the existing pipeline works, the `create-release` job and
extension-zip job already depend on it, and mixing electron-builder's
release-creation with `action-gh-release` invites duplicate/draft-release
conflicts. The only change needed is adding the yml/blockmap files to the upload
globs.

## Testing

- **Unit (vitest, `tests/`):** `isPrerelease` (stable vs. `-beta`/`-alpha`),
  `detectSupport` (win32 / AppImage-via-`APPIMAGE` / darwin / plain-linux),
  channel auto-match, and the event→`UpdateState` reducer. These are pure functions
  with no `electron-updater` runtime dependency.
- **Manual E2E runbook:** documented steps using the mock update server — build at
  version N, bump to N+1, serve, then observe check → download (progress) →
  "Restart to install" → relaunch on N+1. Real-feed Playwright automation is out of
  scope because it requires an actual install + process restart.

## Out of scope (this iteration)

- macOS code signing / notarization (separate task; this design leaves the seam:
  config flags, the `zip` target, and `supported: false` handling).
- Auto-download and silent install (we chose notify-only;
  `autoInstallOnAppQuit` stays off).
- Differential download tuning beyond what blockmaps provide for free.
- A user-facing beta opt-in toggle (we auto-match the running build's channel
  instead).

## Open questions

None blocking. Revisit the 6-hour check cadence and whether to add an
"install on next quit" affordance after the first release ships and we have usage
signal.
