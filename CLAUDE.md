

# Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria lets you loop independently. Weak criteria ("make it work") require constant clarification.


## BEGIN PROJECT  ##

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
src/main/services/           # Core services: database, captureServer, storage, export, settings, hash, safeRegex, openrouter, canonicalJson, csvEscape, installationId, manifest, mhtmlIngest
src/main/services/ai/       # AI services (OpenRouter client)
src/main/ipcHandlers.ts     # All IPC handler registrations
src/shared/types.ts         # Shared TypeScript types (Case, Capture, Tag, Selector, Note, Settings, etc.)
src/shared/ipc.ts           # IPC channel definitions and payload types
src/shared/constants.ts     # Constants (CAPTURE_SERVER_PORT, MAX_MHTML_SIZE, MANIFEST_FILENAME, etc.)
src/renderer/routes/        # TanStack Router route definitions
src/renderer/stores/        # Zustand store (appStore.ts)
src/renderer/hooks/         # React hooks (useTheme, useCaptureThumbnail, useFavorites, useSearch, useSelectorFilters, useServerStatus)
src/renderer/lib/           # React Query client and query/mutation factories
src/renderer/components/    # UI organized by feature (11 directories, ~43 components)
extension/src/              # Chrome extension source (background, content, popup, utils/api, toast)
tests/                      # Vitest unit tests
e2e/                        # Playwright E2E tests
docs/                       # Design docs and specs
```

### Path aliases

- `@main/*` → `src/main/*` (main + preload)
- `@shared/*` → `src/shared/*` (all processes)
- `@renderer/*` → `src/renderer/*` (renderer only)

### IPC pattern

All renderer↔main communication uses typed IPC channels defined in `src/shared/ipc.ts`. Channels follow `domain:action` naming (e.g., `cases:create`, `selectors:create`). Event channels (main→renderer) use `event:` prefix.

**Domains:** cases (5), captures (16), tags (9), search (1), settings (6), export (1), selectors (11), notes (7), events (5).

The preload script exposes these via `window.birdbrain` with typed invoke/on methods.

### Routing

TanStack Router (`@tanstack/react-router`) with the following route tree:

```
/ → Dashboard
/settings → SettingsView
/cases/new → NewCaseWizard
/cases/$caseId → CaseWorkspace (layout with tabs)
  ├── / → CaseOverview
  ├── /captures → CaptureList + CaptureViewer (split view)
  ├── /selectors → SelectorsOverview
  ├── /notes → NotesOverview
  └── /tags → TagsOverview
```

Root layout in `__root.tsx` renders TopBar + main content area.

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

Organized into 11 feature directories under `src/renderer/components/`:

- **captures/** - CaptureItem, CaptureList, CaptureViewer, MhtmlViewer, ProvenanceBadge
- **cases/** - CaseOverview, CaseSwitcher, CaseWorkspace, CreateCaseDialog, NewCaseWizard
- **dashboard/** - Dashboard, CaseCard, DashboardFooter, ExtensionBanner, HeroSection, QuickStartGuide, RecentCases
- **export/** - ExportDialog
- **layout/** - TopBar
- **notes/** - AddNoteModal, CreateNoteCard, NoteCard, NotesOverview
- **search/** - SearchBar
- **selectors/** - BulkAddSelectorsModal, CreateSelectorCard, SelectorFilterFooter, SelectorTable, SelectorTableRow, SelectorsOverview, selectorUtils.ts
- **settings/** - SettingsView, AIConfig, AppearanceConfig, CapturePreferences, OperatorConfig, StorageConfig, About
- **status/** - CaptureHealth, ConnectionStatus, SessionControls
- **tags/** - TagBadge, TagManager, TagsOverview

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


---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
