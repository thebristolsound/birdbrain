<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-20 | Updated: 2026-04-20 -->

# hooks

## Purpose

Cross-cutting React hooks that don't belong to a single feature. Server-state hooks that wrap IPC calls live in `../lib/queries.ts`; this directory is for UI/interaction hooks, theme management, and local view-state helpers.

## Key Files

| File                          | Description                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `useTheme.ts`                 | Light/dark theme state, localStorage persistence, `dark` class toggling on `<html>`, 400ms transition, and IPC sync to `settings` |
| `useServerStatus.ts`          | Subscribes to capture-server health events and exposes connection/readiness flags                                                 |
| `useCaptureThumbnail.ts`      | Resolves a capture's thumbnail path and handles fallback states                                                                   |
| `useFavorites.ts`             | Toggling and reading the per-capture favorite flag                                                                                |
| `useSearch.ts`                | Debounced search query with FTS5 integration                                                                                      |
| `useSelectorFilters.ts`       | Reads and mutates the active selector-filter set driving the capture list                                                         |
| `useStagedReveal.ts`          | Staged/cascading reveal animation helper (for list entry animations)                                                              |
| `useTheater.ts`               | Full-screen "theater mode" toggling for the capture viewer                                                                        |
| `useCompletionCelebration.ts` | One-shot celebration animation helper after a milestone event                                                                     |
| `useCommandPalette.ts`        | Command palette open/close state and keyboard shortcut wiring                                                                     |
| `useOpenRouterModels.ts`      | Fetches the OpenRouter model list (via IPC) and caches it with React Query                                                        |

## Subdirectories

_None._

## For AI Agents

### Working In This Directory

- Prefix hooks with `use` and export a single hook per file.
- Do **not** call `window.birdbrain` directly here for routine CRUD — use the React Query hooks in `../lib/queries.ts`. It's OK to invoke IPC directly for one-shot status/event subscriptions.
- Subscriptions must return an unsubscribe in `useEffect`'s cleanup to avoid listener leaks.

### Testing Requirements

- Tests live in `tests/renderer/hooks/` (see `useTheater.test.ts`, `useCompletionCelebration.test.ts`).
- Use `@testing-library/react`'s `renderHook` with the `happy-dom` environment.

### Common Patterns

- Hooks that bind to IPC events set up the listener in `useEffect`, expose derived state, and return `() => window.birdbrain.off...` to tear down.

## Dependencies

### Internal

- `../lib/queries.ts`, `../stores/appStore.ts`, `@shared/types`, `@shared/ipc`

### External

- `react`, `@tanstack/react-query`, `zustand`

<!-- MANUAL: -->
