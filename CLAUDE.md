# Birdbrain

Open source web investigation & capture tool. Electron desktop app with a companion Chrome extension for capturing and analyzing web content.

## Commands

- `pnpm dev` - Start Electron app in dev mode (electron-vite)
- `pnpm build` - Build the Electron app
- `pnpm build:extension` - Build the Chrome extension
- `pnpm dev:extension` - Build Chrome extension in watch mode (background and popup bundles only; does not watch/rebuild the content script IIFE build)
- `pnpm build:verifier` - Build the standalone verifier binary (`scripts/build-verifier.mjs`)
- `pnpm test` - Run tests (vitest, via Electron runtime). Single file: `pnpm test <path>` — no `--` (`pnpm test -- <path>` does not filter and runs the full suite)
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` / `pnpm coverage:report` / `pnpm coverage:all` - Coverage run and reports
- `pnpm lint` - ESLint (.ts, .tsx)
- `pnpm typecheck` - Typecheck all three tsconfigs (main/preload/shared, renderer, extension)
- `pnpm format` - Prettier format src/ and extension/
- `pnpm rebuild:electron` - Rebuild native deps (better-sqlite3)
- `pnpm test:e2e` - Run E2E tests (Playwright + Electron, runs `pnpm build` first)
- `pnpm test:e2e:debug` - Run E2E tests with Playwright inspector
- `pnpm package` / `pnpm package:win` / `pnpm package:mac` / `pnpm package:linux` - Package for distribution

Docs site commands run from `website/` (separate lockfile — see "Documentation site"): `pnpm dev`, `pnpm build`, `pnpm types:check`.

**Run everything on Node 20.** `.nvmrc` and `.mise.toml` pin it, and CI reads `.nvmrc` (`node-version-file`). `engines.node` is only a floor (`>=20.19.0`) — Node 24 satisfies it, so engines will not keep you off the broken version. `.mise.toml` exists because mise ignores `.nvmrc` by default, so shells and agent worktrees would otherwise land on whatever Node is newest. Under Node 24 Electron's postinstall silently fails to extract the binary (extract-zip's promise never settles): install exits 0 but leaves `node_modules/electron/dist` broken, which is what `scripts/ensure-electron.mjs` now backstops. If Electron is mysteriously missing, check `node --version` first.

## Architecture

Electron + React 19 + TanStack Router + React Query + Chrome Extension + SQLite (better-sqlite3).

### Process model

- **Main process** (`src/main/`) - Electron main, SQLite database, Hono capture server, settings, export
- **Preload** (`src/preload/`) - IPC bridge exposing typed channels to renderer via `window.birdbrain`
- **Renderer** (`src/renderer/`) - React 19 + Tailwind v4 + Zustand + TanStack Router + React Query
- **Chrome extension** (`extension/`) - Content script + background service worker + popup that sends captures to the Hono server

### Key directories

```
src/main/services/           # Main-process services: captureServer, captureStore, storage, export, pdfExport,
                             #   settings, hash, manifest, captureLifecycle, selectorLifecycle, recapture,
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
src/renderer/routes/         # TanStack Router route definitions (root tree plus captures route module)
src/renderer/stores/         # Zustand store (appStore.ts)
src/renderer/hooks/          # React hooks for theme, search, filters, viewport, favorites, session restore, server status, etc.
src/renderer/lib/            # React Query client, query/mutation factories, motion presets, formatting helpers
src/renderer/components/     # UI organized by feature — see "UI components" below
extension/src/               # Chrome extension source (background, content, popup, toast, utils/api, utils/headers)
tests/                       # Vitest unit tests
e2e/                         # Playwright E2E tests
docs/                        # Local working notes — see docs/README.md for layout (reference/, specs/, plans/, archive/)
```

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
- `migrations.ts` - The whole schema history in one `runMigrations(db)` function: a sequence of `if (version < N)` blocks, each running its DDL inside a transaction that ends by setting `db.pragma('user_version = N')`. New schema changes append a new block and bump `LATEST_SCHEMA_VERSION` in `core.ts` — that constant is the single source of truth for the current version, so read it rather than counting blocks.
- Per-domain repos - `caseRepo.ts`, `captureRepo.ts`, `tagRepo.ts`, `selectorRepo.ts`, `noteRepo.ts`, `extractedDataRepo.ts`, `waybackRefRepo.ts`. Each owns the SQL for its aggregate.
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

Hono HTTP server (`src/main/services/captureServer.ts`) on port 19845 receives captures from the Chrome extension. Supports both HTML and MHTML forensic capture formats. Captures are stored as files on disk organized by case directory with SHA-256 hash verification and hash-chained audit manifests.

### Chrome extension

Located in `extension/src/`:

- **background.ts** - Service worker managing extension state and tab capture events
- **content.ts** - Injected into pages for HTML/screenshot capture and selector detection
- **popup/** - React-based popup UI with case selector and capture controls
- **utils/api.ts** - HTTP client targeting `http://127.0.0.1:19845`

Built separately via `pnpm build:extension` (uses `extension/vite.config.ts`).

### AI services

Two OpenRouter modules, split by role:

- `src/main/services/openrouter.ts` - Credential/catalog surface: `testApiKey()` and `listModels()`, exposed over the `settings:testOpenRouter` and `settings:listModels` channels and driven by Settings → AI.
- `src/main/services/ai/openrouter.ts` - The chat client: `sendPrompt()` (with retry/backoff) and `truncateForContext()`.

`src/main/services/ai/analysisService.ts` runs per-capture analysis on top of that client (`analyzeCapture`, `saveAnalysis`, `getAnalysis`, plus archive import/export helpers) and persists to the `capture_analyses` table. Handlers are registered for `ai:analyze`, `ai:saveAnalysis`, and `ai:getAnalysis`; the renderer surface is `captures/AnalysisTab.tsx`.

Note: the v1 `entities` and `case_analyses` tables were dropped in an early migration, but **per-capture analysis exists again** via `capture_analyses` — do not assume AI analysis is dead code.

Settings persist `openRouterApiKey`, `defaultModel`, and `analysisSystemPrompt` (defaulting to `DEFAULT_ANALYSIS_SYSTEM_PROMPT` in `src/shared/constants.ts`).

### UI components

Organized by feature under `src/renderer/components/`:

- **captures/** - Capture list/viewer workflow, details panel/rail, add-URL box, provenance, wayback/analysis/forensics tabs, MHTML viewer, download menu, inline tag/note editing hooks, verify mutation, and the annotation editor under `captures/annotation/` (canvas, zoom/pan and editor hooks, pin popover, shape components under `annotation/shapes/`)
- **dashboard/** - Dashboard, CaseCard, DashboardFooter, ExtensionBanner, HeroSection, QuickStartGuide, RecentCases, plus case workspace components under `dashboard/cases/` (CaseWorkspace, CreateCaseDialog, DataExplorer, ImportCaseDialog, NewCaseWizard)
- **export/** - ExportDialog, ExportMenu, ExportProgress, ExportComplete
- **extension/** - InstallExtensionGuide, InstallExtensionStepper, installSteps.tsx
- **layout/** - TopBar, Sidebar, CommandPalette, OnboardingWizard
- **notes/** - AddNoteModal, CreateNoteCard, NoteCard, NoteBody, NoteEditor, NotesOverview, useNoteEditor.ts
- **overview/** - CaseOverview, CaseSubhead, ActivityTimeline, MetricRow, RecentCapturesStrip, SelectorCoverageBlock, SinceLastVisitBanner, SourcesBlock, VerifyBar, overviewModel.ts
- **search/** - SearchBar
- **selectors/** - BulkAddSelectorsModal, CreateSelectorCard, CreateSelectorPopover, SelectorFilterFooter, SelectorTable, SelectorTableRow, SelectorsOverview, selectorUtils.ts
- **settings/** - SettingsView, AIConfig, AppearanceConfig, CapturePreferences, DatabaseAdmin, DiagnosticsPanel, OperatorConfig, StorageConfig, UpdatesConfig, About, plus database utility views under `settings/db/`
- **status/** - CaptureHealth, ConnectionStatus, SessionControls
- **tags/** - TagBadge, TagManager, TagsOverview
- **ui/** - Shared primitives re-exported from `ui/index.ts`: badge, button, card, dialog, input, label, scroll-area, skeleton, tabs, textarea

## Documentation conventions

All design docs, specs, and implementation plans live under `docs/` per the layout in `docs/README.md`. Canonical paths:

- **Specs / design briefs / spikes** → `docs/specs/YYYY-MM-DD-<slug>-design.md` (or `-spike.md`, `-brief.md`, `-assessment.md`) — **tracked**
- **Implementation plans / checklists** → `docs/plans/YYYY-MM-DD-<slug>.md` — **tracked**
- **Long-lived reference** → `website/content/docs/<topic>.mdx` (no date prefix) — **tracked**, and published to the docs site
- **Architecture decisions** → `docs/adr/NNNN-<slug>.md` — **tracked**
- **Superseded** → `docs/archive/` (preserve original filename) — **tracked**

Long-lived reference docs moved out of `docs/reference/` into `website/content/docs/` when the docs site was set up — they are the site's content now. Adding one means adding an `.mdx` file with `title`/`description` frontmatter plus an entry in `website/content/docs/meta.json` (pages absent from `meta.json` are silently dropped from the sidebar). See "Documentation site" below for the MDX constraints.

**`docs/plans/` is tracked (since July 2026).** Plans are still author-time working notes: they get checked off and go stale, and staleness is expected.

**Docs may ship in the same PR as the code they describe.** There is no requirement to split specs, plans, ADRs, or reference docs onto their own PR or their own commit. Bundling a doc with the `src/**` change it documents is normal and preferred — a guide for a feature that has not merged yet is worth less on its own, and the split costs more than it returns.

**Override for agentic tooling:** When a skill or agent specifies a different default path (e.g. Superpowers' `docs/superpowers/specs/` and `docs/superpowers/plans/`), treat the canonical paths above as the user-preference override. Write specs to `docs/specs/` and plans to `docs/plans/`. The legacy `docs/superpowers/` tree is frozen — do not add new files there.

## Documentation site

`website/` is the public docs site — Next.js 16 + Fumadocs UI/MDX, statically exported and published to GitHub Pages at <https://thebristolsound.github.io/birdbrain/> by `.github/workflows/docs.yml`.

**It is a deliberately isolated sub-project.** It has its own `package.json`, `pnpm-lock.yaml`, and `node_modules`. The repo root does have a `pnpm-workspace.yaml`, but **only** to hold the pnpm settings that used to live in the `pnpm` field of `package.json` (`onlyBuiltDependencies`, `overrides`, `supportedArchitectures`) — pnpm 10.28 stopped reading them there. It deliberately has no `packages:` key, so nothing is registered as a workspace member and `website/` stays isolated. Do not add one.

`website/pnpm-workspace.yaml` enforces that isolation from the other side: it makes `website/` its own workspace root, so a `pnpm` command run inside `website/` stops there instead of walking up and inheriting the root's `overrides` and `onlyBuiltDependencies`. It also carries the site's own `allowBuilds` approvals (esbuild, sharp). Consequences:

- Run its commands from inside `website/`: `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm types:check`. A root `pnpm install` does not touch it.
- The root toolchain ignores it: `eslint.config.js` lists `website/`, `pnpm format` is scoped to `src/`+`extension/`, the root tsconfigs only include `src/**`, and `build.files` in the root `package.json` excludes `website/**/*` so it never ships inside the packaged app.
- `next.config.mjs` pins `turbopack.root` to `website/`, or Turbopack finds the root lockfile and infers the wrong workspace root.

Content lives in `website/content/docs/` (`.mdx` + `meta.json`), images in `website/public/assets/`. Things worth knowing before editing content:

- **Bare `{...}` in prose breaks the build.** MDX parses braces as JSX expressions, so `{source}` or `{a, b}` in body text is a compile error. Wrap them in backticks.
- **Internal doc links need the `./name.mdx` form.** `createRelativeLink` only rewrites hrefs starting with `./` or `../`; a bare slug is emitted as-is and resolves wrong under `trailingSlash: true`.
- **Image paths are `public/`-relative** (`/assets/x.png`). Fumadocs turns them into `next/image` imports, so `basePath` is applied for you — do not hardcode `/birdbrain/`.
- Anything that builds a URL by hand does need the prefix; import `basePath` from `website/lib/base-path.mjs` (that is why the static search client passes `from`).

### Mintlify mirror (evaluation)

A Mintlify deployment (`birdbrain`) renders the same MDX as a second, read-only mirror while
the platform is being evaluated. GitHub Pages remains the published site — Mintlify is not
wired into CI and nothing in the root toolchain depends on it.

`website/content/docs.json` is its config. Note the placement: it is a **sibling** of
`content/docs/`, not inside it. `defineDocs({ dir: 'content/docs' })` globs JSON files under
that directory into the Fumadocs meta collection, so a `docs.json` placed *in* `content/docs/`
risks being parsed as a meta node and breaking `pnpm build`. Keep it one level up.

**The deployment's git source must be configured by hand in the Mintlify dashboard — the repo
cannot set it.** Two fields matter:

- **Deploy branch: `main`.** The default branch was renamed from `master`, and a stale `master`
  still exists on origin. It predates `website/`, so a deployment left pointing at it sees a
  repo with no docs in it at all.
- **Content directory: `website/content`.** This is what makes `docs.json` discoverable given
  the placement above, and it is why every entry in `navigation.groups[].pages` carries a
  `docs/` prefix — those paths are relative to the content directory, not to `docs.json`.

Two known gaps in the mirror, both inherent to serving one content tree through two renderers:

- **Cross-page links render dead on Mintlify.** The 23 internal links use the `./name.mdx`
  form that Fumadocs' `createRelativeLink` requires; Mintlify wants extensionless
  root-relative paths. No single syntax satisfies both — fixing one breaks the other.
- **Screenshots 404 on Mintlify.** `screenshots.mdx` references `/assets/*.png`, served by
  Next from `website/public/assets/`. Mintlify resolves assets from its own content root and
  has no `public/` convention, so the images fall outside what it can see.

Adding a page means updating **both** `content/docs/meta.json` and `docs.json` — a page missing
from either is silently dropped from that site's sidebar.

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

Issues live as GitHub Issues in `thebristolsound/birdbrain`, accessed via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles using their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Background jobs (project-local carve-out)

Unattended/background agent jobs working a `ready-for-agent` issue in this repo are opted out
of the global wait-for-confirmation rules: do not pause for mid-task approval and do not wait
for the user to confirm completion. Instead, verify the work (`pnpm lint`, `pnpm typecheck`,
`BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test`, `pnpm build`, plus `pnpm build:extension` when
`extension/` changed, **plus `pnpm test:coverage` and `pnpm coverage:diff`**), then finish by
opening a **draft PR** with the standard attribution line.

Those last two are the ones that catch what the others cannot. CI's job named `test` runs the
suite *and then* `scripts/diff-coverage.mjs`, which fails the PR below 90% of changed lines
covered — a threshold `pnpm test` never evaluates, since it omits `--coverage`. Without them
the loop reports green on a PR CI rejects, and the red arrives after the agent has claimed
success. Interactive sessions are not covered by this carve-out, and it must not be copied to the
global CLAUDE.md or other repos.

The gates in `docs/adr/0005-unattended-agents-on-the-evidence-path.md` still apply in full:
strict-serial WIP (max one open agent PR), human review on every agent PR through the pilot,
evidence-affecting PRs never auto-merge, and the give-up path (comment findings on the issue, relabel
`needs-info`/`ready-for-human`, vacate the slot) whenever the issue fails the ready-for-agent
bar at intake or mid-work.
