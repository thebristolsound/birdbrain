# Architecture

Electron + React 19 + TanStack Router + React Query + Chrome Extension + SQLite (better-sqlite3).

### Process model

- **Main process** (`src/main/`) - Electron main, SQLite database, Hono capture server, settings, export
- **Preload** (`src/preload/`) - IPC bridge exposing typed channels to renderer via `window.birdbrain`
- **Renderer** (`src/renderer/`) - React 19 + Tailwind v4 + Zustand + TanStack Router + React Query
- **Chrome extension** (`extension/`) - Content script + background service worker + popup that sends captures to the Hono server

Paths in this document are repository-root relative.

### Key directories

```
src/main/services/           # Main-process services: captureServer, captureStore, storage, export, pdfExport,
                             #   settings, manifest, captureLifecycle, selectorLifecycle, recapture,
                             #   annotations, caseArchive, zip/zipRead, timestamp/trustedTime/tsaTrust,
                             #   signingKey, certification, waybackMachine, diagnostics, updater, deepLink,
                             #   noteAnchorResolver, logSafe
src/main/services/db/        # Data access layer — see "Database" below (core, migrations, per-domain repos, dbAdmin)
src/main/services/ai/        # OpenRouter chat client + capture analysis service
src/main/services/extraction/ # Extracted-data pipeline (source, IOC adapter, sanitizer, validators)
src/main/ipcHandlers.ts      # All IPC handler registrations
src/main/ipcWrap.ts          # handle() wrapper + IpcFailure error envelope
src/shared/types.ts          # Cross-process domain types (Case, Capture, Tag, Selector, Note, Settings, etc.)
src/shared/ipc.ts            # IPC channel definitions and payload types
src/shared/constants.ts      # Constants (CAPTURE_SERVER_PORT, MAX_MHTML_SIZE, MANIFEST_FILENAME, etc.)
src/shared/schemas.ts        # Zod schemas validating settings and imported/exported documents
src/shared/noteDoc.ts        # Rich-text note document model + body derivation
src/shared/noteAnchor.ts     # Note anchor model + text-anchor resolution
src/shared/verify/           # Evidence-package verification (canonicalJson, manifestChain, signature, timestampToken)
src/verifier/cli.ts          # Standalone verifier CLI entry point
src/packages/                # Deep-module packages (entry points at the root, lib/ and tests/ private)
src/renderer/routes/         # TanStack Router route definitions (root tree plus captures route module)
src/renderer/stores/         # Zustand store (appStore.ts)
src/renderer/hooks/          # React hooks for theme, search, filters, viewport, favorites, session restore, server status, etc.
src/renderer/lib/            # React Query client, query/mutation factories, motion presets, formatting helpers
src/renderer/components/     # UI organized by feature — see "UI components" below
extension/src/               # Chrome extension source (background, content, popup, options, toast, utils/api, utils/headers)
tests/                       # Vitest unit tests
e2e/                         # Playwright E2E tests
docs/                        # Local working notes — see docs/README.md for layout (reference/, specs/, plans/, archive/)
```

Packages are deep modules - see [src/packages/README.md](../../src/packages/README.md) before adding or importing one.

### Path aliases

- `@main/*` → `src/main/*` (main + preload)
- `@shared/*` → `src/shared/*` (all processes)
- `@renderer/*` → `src/renderer/*` (renderer only)

### IPC pattern

All renderer↔main communication uses typed IPC channels defined in `src/shared/ipc.ts`. Channels follow `domain:action` naming (e.g., `cases:create`, `selectors:create`). Event channels (main→renderer) use `event:` prefix.

**Domains** (read `IPC_CHANNELS` in `src/shared/ipc.ts` for the authoritative list): cases, captures, recapture, tags, search, settings, export, selectors, notes, wayback, extractedData, annotations, extension, shell, app, diagnostics, updates, ai, db — plus the `event:` main→renderer channels.

The preload script exposes these via `window.birdbrain` with typed invoke/on methods.

### Routing

TanStack Router (`@tanstack/react-router`) with the following route tree:

```
/ → Dashboard
/settings → SettingsView
/cases/new → NewCaseWizard
/cases/$caseId → CaseWorkspace (layout with tabs)
  ├── / → redirects to /overview
  ├── /overview → CaseOverview
  ├── /captures → CaptureList + CaptureViewer (split view)
  ├── /notes → NotesOverview
  ├── /signals → SignalsOverview (selectors + tags on one screen)
  └── /data → DataExplorer
```

Root layout in `__root.tsx` renders TopBar, optional case Sidebar, main content area, CommandPalette, the coach-mark onboarding tour, and devtools in development.

### Data fetching

React Query (`@tanstack/react-query`) manages all server state. Configuration in `src/renderer/lib/`:

- `queryClient.ts` - retry=false, staleTime=30s, refetchOnWindowFocus=false
- `api/` - The query layer, one module per IPC domain: `keys.ts` holds the query key factory, and each domain module holds its typed query options and mutation hooks (useCasesMutations, useCapturesMutations, etc.) with automatic cache invalidation
- `queries.ts` - A re-export barrel over `api/` while call sites migrate (#229); import from the domain module in new code. Deleted once the migration lands

### State management

Zustand store (`src/renderer/stores/appStore.ts`) for UI-only state:

- Session state (sessionActive, connectedToExtension)
- Selection state (selectedCaptureId, selectedCaptureIds)
- Search and filter state (searchQuery, activeSelectorFilters, filteredCaptureIds)
- Capture activity (captureEvents, captureStats)

### Database

SQLite via better-sqlite3. The data-access layer lives in `src/main/services/db/`:

- `core.ts` - Owns the connection. `initDatabase()` opens the file, sets the pragmas (`journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout`), then runs migrations. Also exports `getDb()`, `closeDatabase()`, `withTransaction()`, the `ImportCtx` archive-import context, and `ID_PROBE_TABLES` / `hasRowWithId()` for archive-import id collision remapping.
- `migrations.ts` - The whole schema history in one `runMigrations(db)` function: a sequence of `if (version < N)` blocks, each running its DDL inside a transaction that ends by setting `db.pragma('user_version = N')`. New schema changes append a new block and bump `LATEST_SCHEMA_VERSION` in `core.ts` (`pnpm db:migration:new <slug>` does both) — that constant is the single source of truth for the current version, so read it rather than counting blocks. The generated scaffold throws until its DDL replaces the TODO.
- Per-domain repos - `caseRepo.ts`, `captureRepo.ts`, `tagRepo.ts`, `selectorRepo.ts`, `noteRepo.ts`, `noteReferenceRepo.ts`, `extractedDataRepo.ts`, `waybackRefRepo.ts`. Each owns the SQL for its aggregate. `noteReferenceRepo.ts` owns the note Mention references index (`note_references`) — derived state, rewritten inside the transaction of every note-body write, never a source of truth.
- `dbAdmin.ts` - Generic table browse/edit, vacuum, FTS rebuild, orphan cleanup, backup/restore, CSV export (backs Settings → Database).
- `diagnosticsRepo.ts` - Read-only DB facts for Settings → Diagnostics, including the live `user_version` alongside `LATEST_SCHEMA_VERSION`.

**Raw connection access is lint-enforced:** `eslint.config.js` restricts importing `getDb` from `@main/services/db/core` anywhere under `src/main/` outside `src/main/services/db/`. New SQL belongs in a repo module; the few legacy exceptions carry an `eslint-disable` with a reason.

**Tables and indexes:** read `migrations.ts` — it is the only place tables and indexes are declared, in chronological order. Broadly: case/capture core plus tags, selectors and selector matches, notes, favorites, capture analyses, extracted data, annotations and annotation pins, pinned Wayback refs (table `capture_archive_refs`), capture texts, and FTS5 virtual tables shadowing captures, notes, and extracted data. Never assume a table exists because it appears in an early migration — later migrations drop and rebuild some (e.g. the v1 `entities` and `case_analyses` tables were dropped, and `captures_fts` was later dropped and recreated).

### Theme system

Light/dark theme support using CSS custom properties and Tailwind v4:

- **CSS tokens** (`src/renderer/styles/globals.css`) - `@theme` block defines semantic color variables (canvas, text, accent, border, surface, etc.) with light/dark variants via `.dark` class
- **useTheme hook** (`src/renderer/hooks/useTheme.ts`) - Manages theme state, localStorage persistence, `dark` class on `<html>`, 400ms transition animations, and IPC sync to settings
- **Flash prevention** - Inline script in HTML prevents theme flicker on load
- **Component convention** - Prefer semantic token classes (e.g., `bg-canvas`, `text-text-primary`, `border-border`) over raw Tailwind colors; exceptions include overlays (`bg-black`) and status/severity colors (`bg-red-600`, etc.)

### Capture server

Hono HTTP server (`src/main/services/captureServer.ts`) on port 19845 receives captures from the Chrome extension. MHTML is the only format the extension produces; `format: 'html'` is a read-only legacy value for pre-v11 captures. Captures are stored as files on disk organized by case directory with SHA-256 hash verification and hash-chained audit manifests.

### Chrome extension

Located in `extension/src/`:

- **background.ts** - Service worker managing extension state and tab capture events
- **content.ts** - Injected into pages for HTML/screenshot capture and selector detection
- **popup/** - React-based popup UI with case selector and capture controls
- **options/** - Read-only options page (`options.html`), opened in a tab by the popup footer gear
- **utils/api.ts** - HTTP client targeting `http://127.0.0.1:19845`

Built separately via `pnpm build:extension` (uses `extension/vite.config.ts`). Both HTML entries
(`popup`, `options`) are listed in `HTML_ENTRIES` there; the `closeBundle` fixup lifts each one
from its nested Rollup path to the dist root and injects `theme-preinit.js`.

### AI services

Two OpenRouter modules, split by role:

- `src/main/services/openrouter.ts` - Credential/catalog surface: `testApiKey()` and `listModels()`, exposed over the `settings:testOpenRouter` and `settings:listModels` channels and driven by Settings → AI.
- `src/main/services/ai/openrouter.ts` - The chat client: `sendPrompt()` (with retry/backoff) and `truncateForContext()`.

`src/main/services/ai/analysisService.ts` runs per-capture analysis on top of that client (`analyzeCapture`, `saveAnalysis`, `getAnalysis`, plus archive import/export helpers) and persists to the `capture_analyses` table. Handlers are registered for `ai:analyze`, `ai:saveAnalysis`, and `ai:getAnalysis`; the renderer surface is `captures/AnalysisTab.tsx`.

Note: the v1 `entities` and `case_analyses` tables were dropped in an early migration, but **per-capture analysis exists again** via `capture_analyses` — do not assume AI analysis is dead code.

Settings persist `openRouterApiKey`, `defaultModel`, and `analysisSystemPrompt` (defaulting to `DEFAULT_ANALYSIS_SYSTEM_PROMPT` in `src/shared/constants.ts`).

### UI components

Organized by feature under `src/renderer/components/`:

- **captures/** - Capture list/viewer workflow (three resizable columns, each side one collapsible to a 40px rail), details panel/rail, add-URL box, provenance, viewer tabs Screenshot/Page/Text/Wayback, analysis and forensics sections, MHTML viewer, download menu, inline tag/note editing hooks, verify mutation, and the annotation editor under `captures/annotation/` (canvas, zoom/pan and editor hooks, pin popover, shape components under `annotation/shapes/`)
- **dashboard/** - Dashboard, CaseCard, DashboardFooter, ExtensionBanner, HeroSection, QuickStartGuide, RecentCases, plus case workspace components under `dashboard/cases/` (CaseWorkspace, CreateCaseDialog, DataExplorer, ImportCaseDialog, NewCaseWizard)
- **data/** - The Data screen's parts (#1149, #1150): `dataTreeModel.ts`, `dataTableModel.ts` and `ledgerModel.ts` (pure models over the exhibit inventory and the manifest snapshot), DataTree, ArtifactTable, ArtifactTabs, the per-row tabs (PropertiesTab, ExtractedTextTab, HeadersTlsTab, ManifestLedger), IntegrityStrip, and IndicatorsView (the extracted-data browser, reachable as Results > Indicators). `dashboard/cases/DataExplorer.tsx` is the shell that mounts them
- **export/** - ExportDialog, ExportMenu, ExportProgress, ExportComplete
- **extension/** - InstallExtensionStepper, installSteps.tsx
- **layout/** - TopBar, Sidebar, CommandPalette
- **onboarding/** - The coach-mark tour: OnboardingTour (the single mount), useTourEngine, WelcomeCard, CoachMark, ScreenCard, plus the pure `tourSteps.ts` (chapters, counters, completion rules) and `tourGeometry.ts` (layout maths). `startTour(chapter)` dispatches the `birdbrain:tour` event any entry point uses
- **notes/** - AddNoteModal, CreateNoteCard, NoteCard, NoteBody, NoteEditor, NotesOverview, useNoteEditor.ts
- **overview/** - CaseOverview, CaseSubhead, ActivityTimeline, MetricRow, RecentCapturesStrip, SelectorCoverageBlock, SinceLastVisitBanner, SourcesBlock, VerifyBar, overviewModel.ts
- **search/** - SearchBar
- **selectors/** - CreateSelectorCard, CreateSelectorPopover, selectorOrigin.ts, selectorUtils.ts, useForegroundMatchPreview.ts (the Selectors screen itself moved to `signals/`)
- **settings/** - SettingsView, AIConfig, AppearanceConfig, CapturePreferences, DatabaseAdmin, DiagnosticsPanel, OperatorConfig, StorageConfig, UpdatesConfig, About, plus database utility views under `settings/db/`
- **signals/** - SignalsOverview (the consolidated Signals screen), AutoCaptureCard, AddSelectorRow, AddTagRow, BulkImportDrawer, SignalRow, CoverageStrip, SignalDetailRail, signalsModel.ts
- **status/** - CaptureHealth, ConnectionStatus, SessionControls
- **tags/** - TagBadge
- **ui/** - Shared primitives re-exported from `ui/index.ts`: badge, button, card, dialog, input, label, scroll-area, skeleton, tabs, textarea
