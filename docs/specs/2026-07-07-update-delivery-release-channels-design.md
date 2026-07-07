# Update delivery with selectable release channels — design

**Date:** 2026-07-07
**Status:** Proposed
**Scope:** Electron desktop app (`src/main`, `src/renderer`, build/CI). The Chrome extension is out of scope — it updates through its own distribution path.

## Problem

Birdbrain has no update mechanism. Releases are packaged with `--publish never` and uploaded to GitHub Releases by the tag-push workflow (`.github/workflows/release.yml`), but installed apps never learn a newer version exists. Testers on `1.0.1-beta.x` builds must manually watch the releases page and reinstall.

We want:

1. **Update delivery** — the app detects, downloads, and installs new releases.
2. **Selectable release channel** — users choose between **Stable** (tagged releases like `v1.1.0`) and **Beta** (prerelease tags like `v1.0.1-beta.11`). Beta sees both; Stable sees only stable.

## Approach

Use **`electron-updater`** (from the electron-builder ecosystem) with the **GitHub Releases provider**. This is the standard path for our exact setup: electron-builder packaging, GitHub Releases hosting, no dedicated update server.

Channel semantics ride on what the release workflow already does: tags containing `alpha`/`beta` are published as GitHub *prereleases*. On the client, `autoUpdater.allowPrerelease` toggles whether prereleases are considered:

- **Stable channel** → `allowPrerelease = false`: only the latest non-prerelease release.
- **Beta channel** → `allowPrerelease = true`: latest release including prereleases. Semver ordering means a newer stable also reaches beta users.

Switching Beta → Stable never downgrades (`allowDowngrade` stays `false`); the user stays on their beta build until a higher-versioned stable ships.

### Platform support matrix

| Platform | Target | Auto-update | Notes |
|---|---|---|---|
| Windows | NSIS | ✅ full | Works unsigned (SmartScreen warning at install time only, unchanged from today) |
| Linux | AppImage | ✅ full | Built-in electron-updater support |
| Linux | deb | ❌ | Notify + link to release page |
| macOS | dmg + zip | ⚠️ blocked on signing | Squirrel.Mac **requires a signed app** and updates from a `zip` target. Until we have Developer ID signing + notarization: notify + link to release page |

Where auto-update isn't possible, the same UI degrades to *notify*: "Update available → View release", opening the GitHub release page.

## Changes

### 1. Build & publish configuration (`package.json` `build` block)

- Add `publish: [{ "provider": "github", "owner": "thebristolsound", "repo": "birdbrain" }]`. With a publish config present, electron-builder generates the update-info files (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`, or `beta*.yml` for prerelease versions) and `.blockmap` files even under `--publish never`.
- Add `generateUpdatesFilesForAllChannels: true` so stable releases also emit `beta.yml` — beta-channel clients can then resolve updates from stable releases without special-casing.
- macOS: change target from `["dmg"]` to `["dmg", "zip"]` (zip is what Squirrel.Mac consumes; dmg remains the human download).

### 2. Release workflow (`.github/workflows/release.yml`)

Extend each platform's upload glob so update metadata lands on the release next to the installers:

- Windows: `dist/*.exe`, `dist/*.blockmap`, `dist/*.yml`
- macOS: `dist/*.dmg`, `dist/*.zip`, `dist/*.blockmap`, `dist/*-mac.yml`
- Linux: `dist/*.{AppImage,deb}`, `dist/*-linux.yml`

No other CI changes — we keep `--publish never` + softprops upload rather than electron-builder's own publisher, so the existing create-release/prerelease logic stays the single source of truth.

### 3. Settings (`src/shared/types.ts`, `src/shared/schemas.ts`, `src/main/services/settings.ts`)

Two new fields on `BirdbrainSettings`:

```ts
releaseChannel: 'stable' | 'beta'   // zod: z.enum(['stable', 'beta'])
autoCheckForUpdates: boolean        // default true
```

Default for `releaseChannel`: derived at first run from the installed version — `app.getVersion()` containing a prerelease suffix → `'beta'`, else `'stable'`. This keeps today's beta testers on the beta channel instead of silently parking them until the first stable release. (Implementation: `DEFAULT_SETTINGS.releaseChannel` is set in `initSettings()` the same way `storagePath` is.)

### 4. Updater service (`src/main/services/updater.ts`)

New main-process service wrapping `electron-updater`'s `autoUpdater`:

- **Guard:** no-op when `!app.isPackaged` (dev) and on unsupported install formats (deb, unsigned mac) — in those cases checks still run but resolution is *notify-only* (expose `supportsAutoInstall: false` in status).
- **Config:** `autoDownload = false` (download only on explicit user action or when `autoCheckForUpdates` policy says so — see below), `autoInstallOnAppQuit = true`, `allowDowngrade = false`, `allowPrerelease` from `releaseChannel`.
- **Never restart on its own.** Birdbrain is a forensic capture tool; an update must never interrupt an active capture session. Install happens only via the explicit "Restart to update" action or naturally on next quit.
- **Schedule:** when `autoCheckForUpdates` is true, check ~30 s after launch and every 4 h thereafter; manual "Check for updates" is always available.
- **State machine** exposed to the renderer:

```
idle → checking → up-to-date
                → available → downloading(percent) → downloaded
                → error(message)
```

- Channel changes (via `settings:update`) reconfigure `allowPrerelease` and trigger a fresh check.

### 5. IPC (`src/shared/ipc.ts`, preload)

New `updates` domain following the existing `domain:action` pattern:

| Channel | Direction | Payload |
|---|---|---|
| `updates:getStatus` | invoke | → `UpdateStatus` |
| `updates:check` | invoke | → `UpdateStatus` |
| `updates:download` | invoke | → `void` (progress via event) |
| `updates:install` | invoke | quits and installs |
| `event:updateStatus` | main → renderer | `UpdateStatus` on every transition |

`UpdateStatus` (in `src/shared/types.ts`): `{ state, currentVersion, availableVersion?, releaseNotesUrl?, percent?, error?, supportsAutoInstall }`.

### 6. Renderer

- **`src/renderer/components/settings/UpdatesConfig.tsx`** — new card in `SettingsView` (adjacent to About): current version, channel selector (Stable / Beta with a one-line description of what Beta means), auto-check toggle, "Check for updates" button, status line with download progress, and "Restart to update" once downloaded. Beta→Stable switch shows the no-downgrade note. Uses existing settings mutation hooks; update status via a new `useUpdateStatus` hook subscribing to `event:updateStatus` (event-driven UI state lives in the Zustand pattern already used for capture activity, or hook-local state — hook-local preferred since only Settings and the badge consume it).
- **Downloaded indicator** — a small dot/badge on the TopBar settings entry when an update is downloaded, so users who never open Settings still find out. No toasts, no modals.

### 7. Integrity

`electron-updater` verifies the SHA-512 from the update-info yml against the downloaded artifact. On Windows it additionally validates the code signature when present (we're unsigned today — the hash check still applies, and the yml is fetched from our GitHub Releases over TLS). When macOS signing lands, add `publisherName`/identity pinning as part of that work.

## Phasing

1. **Phase 1 — plumbing + notify (all platforms):** publish config, CI globs, settings fields, updater service in check-only mode, Settings UI with channel selector. Ships value immediately: every install learns about new releases.
2. **Phase 2 — full auto-update on Windows NSIS + Linux AppImage:** enable download/install path, progress UI, restart-to-update.
3. **Phase 3 — macOS auto-update:** blocked on acquiring Apple Developer ID + notarization in CI. Until then macOS stays on notify. Tracked separately.

Phases 1+2 are one PR-sized change each; nothing blocks on Apple.

## Testing

- **Unit (vitest):** settings schema defaults/validation for the new fields; updater service state machine with a mocked `electron-updater` (transitions, channel→`allowPrerelease` mapping, notify-only fallback flagging, no-op in dev).
- **Manual:** `dev-app-update.yml` pointing at the repo lets a packaged local build exercise the real check/download path against existing releases; verify beta↔stable switching against the current release history (betas only — confirms stable channel correctly reports up-to-date/none).
- **E2E:** out of scope — Playwright drives unpackaged builds where the updater is guarded off.

## Open questions

1. **Stable channel is empty today** — every release so far is a beta prerelease. The first stable tag (e.g. `v1.1.0`) is what makes the Stable channel real. Until then the channel selector is honest but Stable reports "up to date".
2. **macOS signing** — needs an Apple Developer account decision before Phase 3.
3. **deb users** — acceptable to leave on notify-only permanently, or drop deb in favor of AppImage-only later.
