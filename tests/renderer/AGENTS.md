<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-20 | Updated: 2026-04-20 -->

# renderer (tests)

## Purpose

Vitest tests for the renderer. Uses `happy-dom` for DOM-dependent hooks and components and `@testing-library/react` for `render` / `renderHook`. Most feature UI is covered by Playwright E2E; this directory focuses on hooks, stores, library utilities, and shared UI primitives.

## Subdirectories

| Directory     | Purpose                                                             |
| ------------- | ------------------------------------------------------------------- |
| `hooks/`      | Hook tests (see `hooks/AGENTS.md`)                                  |
| `stores/`     | Zustand store tests (see `stores/AGENTS.md`)                        |
| `lib/`        | Utility and motion-primitive tests (see `lib/AGENTS.md`)            |
| `components/` | Shared UI primitive tests (e.g. `QueryState`). Uses `.test.tsx`.    |

## For AI Agents

### Working In This Directory

- Stub `window.birdbrain` per test; do not share mock state across tests.
- Reset Zustand stores between tests to avoid cross-test pollution.
- Prefer the `renderHook` API for hook tests — render a full component only when the hook is unobservable otherwise.

## Dependencies

### Internal

- `../../src/renderer/*`

### External

- `vitest`, `@testing-library/react`, `happy-dom`

<!-- MANUAL: -->
