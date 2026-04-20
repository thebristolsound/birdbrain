<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-20 | Updated: 2026-04-20 -->

# hooks (tests)

## Purpose

Tests for hooks in `src/renderer/hooks/`. Covers animation/session logic that's hard to verify from E2E.

## Key Files

| File                               | Description                                           |
| ---------------------------------- | ----------------------------------------------------- |
| `useTheater.test.ts`               | Theater-mode toggle behavior                          |
| `useCompletionCelebration.test.ts` | One-shot celebration fires exactly once per milestone |

## Subdirectories

_None._

## For AI Agents

### Working In This Directory

- Use `renderHook` from `@testing-library/react`; wrap with the providers the hook needs (QueryClient, Router if required).
- Mock `window.birdbrain` methods the hook invokes. Reset mocks in `afterEach`.

## Dependencies

### Internal

- `../../../src/renderer/hooks/*`

### External

- `vitest`, `@testing-library/react`, `happy-dom`

<!-- MANUAL: -->
