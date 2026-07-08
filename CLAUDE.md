# Birdbrain

Open source web investigation & capture tool. Electron desktop app with a companion Chrome extension for capturing and analyzing web content.

## Commands

- `pnpm dev` - Start Electron app in dev mode (electron-vite)
- `pnpm build` - Build the Electron app
- `pnpm build:extension` - Build the Chrome extension
- `pnpm dev:extension` - Build Chrome extension in watch mode (background and popup bundles only; does not watch/rebuild the content script IIFE build)
- `pnpm test` - Run tests (vitest, via Electron runtime)
- `pnpm test:watch` - Run tests in watch mode
- `pnpm lint` - ESLint (.ts, .tsx)
- `pnpm format` - Prettier format src/ and extension/
- `pnpm rebuild:electron` - Rebuild native deps (better-sqlite3)
- `pnpm test:e2e` - Run E2E tests (Playwright + Electron, runs `pnpm build` first)
- `pnpm test:e2e:debug` - Run E2E tests with Playwright inspector
- `pnpm package` / `pnpm package:win` / `pnpm package:mac` - Package for distribution

## Architecture

Electron + React 19 + TanStack Router + React Query + Chrome Extension + SQLite (better-sqlite3).

### Process model

- **Main process** (`src/main/`) - Electron main, SQLite database, Hono capture server, settings, export
- **Preload** (`src/preload/`) - IPC bridge exposing typed channels to renderer via `window.birdbrain`
- **Renderer** (`src/renderer/`) - React 19 + Tailwind v4 + Zustand + TanStack Router + React Query
- **Chrome extension** (`extension/`) - Content script + background service worker + popup that sends captures to the Hono server

### Key directories

```
src/main/services/           # Core services: database, captureServer, storage, export, settings, hash, safeRegex, openrouter, canonicalJson, csvEscape, installationId, manifest, captureLifecycle, updater
src/main/services/ai/       # AI services (OpenRouter client)
src/main/ipcHandlers.ts     # All IPC handler registrations
src/shared/types.ts         # Shared TypeScript types (Case, Capture, Tag, Selector, Note, Settings, etc.)
src/shared/ipc.ts           # IPC channel definitions and payload types
src/shared/constants.ts     # Constants (CAPTURE_SERVER_PORT, MAX_MHTML_SIZE, MANIFEST_FILENAME, etc.)
src/renderer/routes/        # TanStack Router route definitions (root tree plus captures route module)
src/renderer/stores/        # Zustand store (appStore.ts)
src/renderer/hooks/         # React hooks for theme, search, filters, viewport, motion, session restore, server status, etc.
src/renderer/lib/           # React Query client and query/mutation factories
src/renderer/components/    # UI organized by feature (13 top-level directories, ~96 TSX components)
extension/src/              # Chrome extension source (background, content, popup, utils/api, toast)
tests/                      # Vitest unit tests
e2e/                        # Playwright E2E tests
docs/                       # Local working notes — see docs/README.md for layout (reference/, specs/, plans/, archive/)
```

### Path aliases

- `@main/*` → `src/main/*` (main + preload)
- `@shared/*` → `src/shared/*` (all processes)
- `@renderer/*` → `src/renderer/*` (renderer only)

### IPC pattern

All renderer↔main communication uses typed IPC channels defined in `src/shared/ipc.ts`. Channels follow `domain:action` naming (e.g., `cases:create`, `selectors:create`). Event channels (main→renderer) use `event:` prefix.

**Domains:** cases (5), captures (16), tags (9), search (1), settings (6), export (1), selectors (11), notes (7), updates (2), events (5).

The preload script exposes these via `window.birdbrain` with typed invoke/on methods.

### Routing

TanStack Router (`@tanstack/react-router`) with the following route tree:

```
/ → Dashboard
/settings → SettingsView
/extension-setup → InstallExtensionGuide
/cases/new → NewCaseWizard
/cases/$caseId → CaseWorkspace (layout with tabs)
  ├── / → redirects to /overview
  ├── /overview → CaseOverview
  ├── /captures → CaptureList + CaptureViewer (split view)
  ├── /selectors → SelectorsOverview
  ├── /notes → NotesOverview
  ├── /tags → TagsOverview
  └── /data → DataExplorer
```

Root layout in `__root.tsx` renders TopBar, optional case Sidebar, main content area, CommandPalette, onboarding overlay, and devtools in development.

### Data fetching

React Query (`@tanstack/react-query`) manages all server state. Configuration in `src/renderer/lib/`:

- `queryClient.ts` - retry=false, staleTime=30s, refetchOnWindowFocus=false
- `queries.ts` - Query key factory, typed query options, and domain-specific mutation hooks (useCasesMutations, useCapturesMutations, etc.) with automatic cache invalidation

### State management

Zustand store (`src/renderer/stores/appStore.ts`) for UI-only state:

- Session state (sessionActive, connectedToExtension)
- Selection state (selectedCaptureId, selectedCaptureIds)
- Search and filter state (searchQuery, activeSelectorFilters, filteredCaptureIds)
- Capture activity (captureEvents, captureStats)

### Database

SQLite via better-sqlite3 with WAL mode. Schema migrations use `user_version` pragma (currently v1-v12) in `src/main/services/database.ts`.

**Tables:** cases, captures, tags, capture_tags, selectors, selector_matches, captures_fts (FTS5), capture_favorites, notes, notes_fts (FTS5).

**Indexes:** idx_captures_case_id, idx_capture_tags_tag_id, idx_selectors_case_id, idx_selector_matches_capture, idx_capture_favorites_created, idx_captures_format, idx_captures_manifest_index, idx_notes_case_id, idx_notes_capture_id.

### Theme system

Light/dark theme support using CSS custom properties and Tailwind v4:

- **CSS tokens** (`src/renderer/styles/globals.css`) - `@theme` block defines semantic color variables (canvas, text, accent, border, surface, etc.) with light/dark variants via `.dark` class
- **useTheme hook** (`src/renderer/hooks/useTheme.ts`) - Manages theme state, localStorage persistence, `dark` class on `<html>`, 400ms transition animations, and IPC sync to settings
- **Flash prevention** - Inline script in HTML prevents theme flicker on load
- **Component convention** - Prefer semantic token classes (e.g., `bg-canvas`, `text-text-primary`, `border-border`) over raw Tailwind colors; exceptions include overlays (`bg-black`) and status/severity colors (`bg-red-600`, etc.)

### Capture server

Hono HTTP server (`src/main/services/captureServer.ts`) on port 19845 receives captures from the Chrome extension. Supports both HTML and MHTML forensic capture formats. Captures are stored as files on disk organized by case directory with SHA-256 hash verification and hash-chained audit manifests.

### Chrome extension

Located in `extension/src/`:

- **background.ts** - Service worker managing extension state and tab capture events
- **content.ts** - Injected into pages for HTML/screenshot capture and selector detection
- **popup/** - React-based popup UI with case selector and capture controls
- **utils/api.ts** - HTTP client targeting `http://127.0.0.1:19845`

Built separately via `pnpm build:extension` (uses `extension/vite.config.ts`).

### AI services

OpenRouter integration (`src/main/services/openrouter.ts`) provides `testApiKey()` and `listModels()`. Previous entity extraction and case analysis tables were removed in migration v7. Settings persist `openRouterApiKey` and `defaultModel`.

### UI components

Organized into 13 top-level feature directories under `src/renderer/components/`:

- **captures/** - Capture list/viewer workflow, details panel/rail, add-URL box, provenance, archive/analysis/forensics tabs, inline tag/note editing hooks, verify mutation, and annotation editor under `captures/annotation/`
- **dashboard/** - Dashboard, CaseCard, DashboardFooter, ExtensionBanner, HeroSection, QuickStartGuide, RecentCases, plus case workspace components under `dashboard/cases/` (CaseWorkspace, CreateCaseDialog, DataExplorer, NewCaseWizard)
- **export/** - ExportDialog, ExportProgress, ExportComplete
- **extension/** - InstallExtensionGuide, InstallExtensionStepper, installSteps.tsx
- **layout/** - TopBar, Sidebar, CommandPalette, OnboardingWizard, plus export confirmation dialog under `layout/export/`
- **notes/** - AddNoteModal, CreateNoteCard, NoteCard, NotesOverview
- **overview/** - CaseOverview, CaseSubhead, ActivityTimeline, MetricRow, RecentCapturesStrip, SelectorCoverageBlock, SinceLastVisitBanner, SourcesBlock, VerifyBar, overviewModel.ts
- **search/** - SearchBar
- **selectors/** - BulkAddSelectorsModal, CreateSelectorCard, CreateSelectorPopover, SelectorFilterFooter, SelectorTable, SelectorTableRow, SelectorsOverview, selectorUtils.ts
- **settings/** - SettingsView, AIConfig, AppearanceConfig, CapturePreferences, DatabaseAdmin, OperatorConfig, StorageConfig, UpdatesConfig, About, plus database utility views under `settings/db/`
- **status/** - CaptureHealth, ConnectionStatus, SessionControls
- **tags/** - TagBadge, TagManager, TagsOverview
- **ui/** - Shared primitives: badge, button, card, dialog, input, label, scroll-area, skeleton, tabs, textarea

## Documentation conventions

All design docs, specs, and implementation plans live under `docs/` per the layout in `docs/README.md`. Canonical paths:

- **Specs / design briefs / spikes** → `docs/specs/YYYY-MM-DD-<slug>-design.md` (or `-spike.md`, `-brief.md`, `-assessment.md`) — **tracked**
- **Implementation plans / checklists** → `docs/plans/YYYY-MM-DD-<slug>.md` — **local-only (gitignored)**
- **Long-lived reference** → `docs/reference/<topic>.md` (no date prefix) — **tracked**
- **Architecture decisions** → `docs/adr/NNNN-<slug>.md` — **tracked**
- **Superseded** → `docs/archive/` (preserve original filename) — **tracked**

**`docs/plans/` is gitignored.** Plans are author-time working notes that get checked off and rot; they are not version-controlled and do not belong in PRs. Write them, refer to them locally, and let them go stale on disk. Do not `git add docs/plans/...`. Tracked durable docs (specs, ADRs, reference) **must be committed in their own PR** — never bundled with a `src/**` feature change.

**Override for agentic tooling:** When a skill or agent specifies a different default path (e.g. Superpowers' `docs/superpowers/specs/` and `docs/superpowers/plans/`), treat the canonical paths above as the user-preference override. Write specs to `docs/specs/` and plans to `docs/plans/`. The legacy `docs/superpowers/` tree is frozen — do not add new files there.

## Testing

- **Unit tests** (`tests/`) - Vitest running via Electron runtime (`ELECTRON_RUN_AS_NODE=1`). Config in `vitest.config.ts` (node environment, globals enabled). Covers database, services, store, types.
- **E2E tests** (`e2e/`) - Playwright with Electron. Config in `playwright.config.ts` (30s timeout, 1 worker, trace on-first-retry). Requires `pnpm build` first (handled by `pretest:e2e` script).

## Code style

- No semicolons
- Single quotes
- No trailing commas
- 100 char print width
- 2-space indent
- TypeScript strict mode
- React JSX transform (no React import needed)
- ESLint 9 flat config with TypeScript ESLint + Prettier
- Prefer semantic theme tokens over raw color values in components (exceptions: overlays, status/severity colors)

## Agent skills

### Issue tracker

Issues live as GitHub Issues in `thebristolsound/birdbrain`, accessed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles using their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
