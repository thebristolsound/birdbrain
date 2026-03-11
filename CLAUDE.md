# Birdbrain

Open source web investigation & capture tool.

## Commands

- `pnpm dev` - Start Electron app in dev mode (electron-vite)
- `pnpm build` - Build the Electron app
- `pnpm build:extension` - Build the Chrome extension
- `pnpm dev:extension` - Build Chrome extension in watch mode
- `pnpm test` - Run tests (vitest)
- `pnpm test:watch` - Run tests in watch mode
- `pnpm lint` - ESLint (.ts, .tsx)
- `pnpm format` - Prettier format src/ and extension/
- `pnpm rebuild:electron` - Rebuild native deps (better-sqlite3)
- `pnpm test:e2e` - Run E2E tests (Playwright + Electron)
- `pnpm test:e2e:debug` - Run E2E tests with Playwright inspector

## Architecture

Electron + React + Chrome Extension + SQLite (better-sqlite3).

### Process model

- **Main process** (`src/main/`) - Electron main, SQLite database, Hono capture server, AI services
- **Preload** (`src/preload/`) - IPC bridge exposing typed channels to renderer
- **Renderer** (`src/renderer/`) - React 19 + Tailwind v4 + Zustand UI
- **Chrome extension** (`extension/`) - Content script + background + popup that sends captures to the Hono server

### Key directories

```
src/main/services/        # Core services: database, captureServer, storage, export, settings, AI
src/main/services/ai/     # AI pipeline: entityExtraction, relationships, patterns, queue, openrouter
src/main/ipcHandlers.ts   # All IPC handler registrations
src/shared/types.ts       # Shared TypeScript types (Case, Capture, Tag, Entity)
src/shared/ipc.ts         # IPC channel definitions and payload types
src/renderer/stores/      # Zustand store (appStore.ts)
src/renderer/hooks/       # React hooks (useCases, useCaptures, useTags, useSearch, useServerStatus)
src/renderer/components/  # UI organized by feature: cases, captures, tags, search, analysis, export, settings, layout, status
extension/src/            # Chrome extension source (background, content, popup, utils/api)
```

### Path aliases

- `@main/*` → `src/main/*` (main + preload)
- `@shared/*` → `src/shared/*` (all processes)
- `@renderer/*` → `src/renderer/*` (renderer only)

### IPC pattern

All renderer↔main communication uses typed IPC channels defined in `src/shared/ipc.ts`. Channels follow `domain:action` naming (e.g., `cases:create`, `ai:extractEntities`). Event channels (main→renderer) use `event:` prefix.

### Database

SQLite via better-sqlite3 with WAL mode. Schema migrations use `user_version` pragma in `src/main/services/database.ts`. Tables: cases, captures, tags, capture_tags, entities, entity_relationships, analysis_results.

### AI services

AI features use OpenRouter API (`src/main/services/ai/openrouter.ts`). Pipeline: entity extraction → relationship mapping → pattern detection. Jobs processed via async queue (`src/main/services/ai/queue.ts`).

### Capture server

Hono HTTP server (`src/main/services/captureServer.ts`) receives captures from the Chrome extension. Captures are stored as files on disk with SHA-256 hash verification.

## Code style

- No semicolons
- Single quotes
- No trailing commas
- 100 char print width
- 2-space indent
- TypeScript strict mode
- React JSX transform (no React import needed)
