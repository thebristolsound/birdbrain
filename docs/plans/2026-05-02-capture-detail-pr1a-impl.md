# Capture Detail Redesign — PR1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PR1a from `docs/plans/capture-detail-redesign.md` — a three-column capture-detail layout (list + viewer + 400px right panel), responsive collapse with forced rail under 1100px, slim breadcrumb in viewer, and supporting helpers/hooks. Forensics tab rebuild and screenshot polish ship as separate plans (PR1b, PR2).

**Architecture:** Two persisted settings (`detailsPanelCollapsed`, `tooltipsSeen`) and one ephemeral store flag (`panelCollapsedForced`) drive a derived `panelDisplayedCollapsed` value. Panel sections (Header/Metadata/Tags/Notes) are co-located inside `CaptureDetailsPanel.tsx`. Tag editing splits into a state-only hook and a UI popover. Inline notes use debounce + blur + Cmd+Enter saves with controlled-from-server-unless-dirty sync. Provenance shield is shared between breadcrumb and panel via a single hook + a color helper.

**Tech Stack:** React 19, TypeScript, TanStack Query, Zustand, TanStack Router, Tailwind v4 (semantic tokens), Zod for settings, motion/react via `presets`, Vitest (Electron runtime) for unit tests, Playwright + Electron for e2e.

**Branch:** `feat/capture-detail-pr1a` off `master`.

**Source design doc:** [`docs/plans/capture-detail-redesign.md`](./capture-detail-redesign.md) (50-decision log §11).

---

## File Structure

### Edit

- `src/shared/types.ts` — add `detailsPanelCollapsed`, `tooltipsSeen` to `BirdbrainSettings`.
- `src/shared/schemas.ts` — add Zod fields with `.default()`.
- `src/main/services/settings.ts` — extend `DEFAULT_SETTINGS`.
- `src/renderer/lib/queries.ts` — add `settingsQueryOptions` + `useSettingsMutations`.
- `src/renderer/stores/appStore.ts` — add `panelCollapsedForced` + `setPanelCollapsedForced`.
- `src/renderer/routes/cases/$caseId/captures.tsx` — rewrite for 3-column + responsive collapse.
- `src/renderer/components/captures/CaptureViewer.tsx` — strip header → slim breadcrumb, drop Analysis tab, expose `openAddNote`/`openDelete` so panel can trigger them.

### New

- `src/renderer/lib/formatRelativeTime.ts`
- `src/renderer/hooks/useTimeTick.ts`
- `src/renderer/hooks/useViewportWidth.ts`
- `src/renderer/components/captures/getProvenanceColor.ts`
- `src/renderer/components/captures/useVerifyMutation.ts`
- `src/renderer/components/captures/useCaptureTagEditor.ts`
- `src/renderer/components/captures/TagEditorPopover.tsx`
- `src/renderer/components/captures/useInlineNoteEditor.ts`
- `src/renderer/components/captures/CaptureDetailsPanel.tsx`
- `src/renderer/components/captures/CaptureDetailsRail.tsx`

### Tests

- `tests/lib/formatRelativeTime.test.ts`
- `tests/hooks/useViewportWidth.test.ts`
- `tests/components/useCaptureTagEditor.test.ts`
- `tests/components/useInlineNoteEditor.test.ts`
- `e2e/capture-detail-panel.spec.ts`

---

## Conventions for every task

- Code style: no semicolons, single quotes, no trailing commas, 100 char width, 2-space indent (per `CLAUDE.md`).
- Use semantic tokens (`bg-canvas`, `text-text-primary`, `border-border`, `bg-elevated`, `bg-surface`) over raw colors. Status colors (red/amber/emerald) stay raw per `theme.md`.
- Run `pnpm lint` + `pnpm test --run <path>` after each implementation step.
- Commit with subject `<type>(<scope>): <subject>` per repo convention. Stage files explicitly — never `git add .` or `-A`.

---

## Task 0: Branch + verify clean working tree

**Files:** none

- [ ] **Step 1: Verify clean tree**

```powershell
git status --short
```

Expected: only `?? docs/plans/` (the design + impl-plan files). If anything else is dirty, stop and ask the user.

- [ ] **Step 2: Cut feature branch**

```powershell
git switch -c feat/capture-detail-pr1a
```

- [ ] **Step 3: Stage + commit the plan docs** (so subsequent commits are isolated)

```powershell
git add docs/plans/capture-detail-redesign.md docs/plans/2026-05-02-capture-detail-pr1a-impl.md
git commit -m "docs(capture-detail): add design + PR1a implementation plan"
```

---

## Task 1: Add `detailsPanelCollapsed` + `tooltipsSeen` to settings type, defaults, Zod schema

**Files:**

- Modify: `src/shared/types.ts:57-72`
- Modify: `src/shared/schemas.ts:156-174`
- Modify: `src/main/services/settings.ts:44-59`

- [ ] **Step 1: Extend `BirdbrainSettings` type**

Edit `src/shared/types.ts` — append two fields to the interface (after `analysisSystemPrompt: string`):

```ts
export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  dedupeWindowSeconds: number
  ignoredUrlPatterns: string[]
  storagePath: string
  theme: 'dark' | 'light'
  reduceMotion: boolean
  operatorName: string
  autoCaptureMode: AutoCaptureMode
  lastActiveCaseId: string | null
  lastActiveSection: 'captures' | 'selectors' | 'notes' | 'tags' | 'data' | 'settings'
  hasCompletedOnboarding: boolean
  analysisSystemPrompt: string
  detailsPanelCollapsed: boolean
  tooltipsSeen: Record<string, boolean>
}
```

- [ ] **Step 2: Extend `BirdbrainSettingsSchema` with `.default()` so missing keys do not invalidate existing settings files**

Edit `src/shared/schemas.ts` — append two fields inside the `z.object({ ... })` (after `analysisSystemPrompt`):

```ts
export const BirdbrainSettingsSchema = z.object({
  openRouterApiKey: z.string().nullable(),
  defaultModel: z.string(),
  captureScreenshots: z.boolean(),
  dedupeWindowSeconds: z.number(),
  ignoredUrlPatterns: z.array(z.string()),
  storagePath: z.string(),
  theme: z.enum(['dark', 'light']),
  reduceMotion: z.boolean(),
  operatorName: z.string(),
  autoCaptureMode: z.enum(['auto', 'notify', 'per-case']),
  lastActiveCaseId: z.string().nullable(),
  lastActiveSection: z
    .enum(['captures', 'selectors', 'notes', 'tags', 'settings', 'data'])
    .optional()
    .default('captures'),
  hasCompletedOnboarding: z.boolean().optional().default(false),
  analysisSystemPrompt: z.string().optional().default(DEFAULT_ANALYSIS_SYSTEM_PROMPT),
  detailsPanelCollapsed: z.boolean().optional().default(false),
  tooltipsSeen: z.record(z.string(), z.boolean()).optional().default({})
})
```

`PartialBirdbrainSettingsSchema` (line 178) needs no change — it derives `.partial()` from this schema.

- [ ] **Step 3: Add defaults in main process**

Edit `src/main/services/settings.ts` — append to `DEFAULT_SETTINGS` (after `analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT`):

```ts
const DEFAULT_SETTINGS: BirdbrainSettings = {
  openRouterApiKey: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  captureScreenshots: true,
  dedupeWindowSeconds: 60,
  ignoredUrlPatterns: [],
  storagePath: '',
  theme: 'light',
  reduceMotion: false,
  operatorName: '',
  autoCaptureMode: 'notify',
  lastActiveCaseId: null,
  lastActiveSection: 'captures',
  hasCompletedOnboarding: false,
  analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT,
  detailsPanelCollapsed: false,
  tooltipsSeen: {}
}
```

- [ ] **Step 4: Run typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS (no errors).

- [ ] **Step 5: Run unit tests**

```powershell
pnpm test --run tests/services/settings.test.ts
```

Expected: PASS — existing tests still pass because new fields default during parse.

(If `tests/services/settings.test.ts` does not exist, run `pnpm test --run` and confirm no regression.)

- [ ] **Step 6: Commit**

```powershell
git add src/shared/types.ts src/shared/schemas.ts src/main/services/settings.ts
git commit -m "feat(settings): add detailsPanelCollapsed and tooltipsSeen with Zod defaults"
```

---

## Task 2: Add `settingsQueryOptions` + `useSettingsMutations` to queries factory

**Files:**

- Modify: `src/renderer/lib/queries.ts:16-41` (queryKeys), append after notes section
- Test: deferred — covered by Task 19 e2e

The renderer currently reads settings ad-hoc via `window.birdbrain.settings.get()`. The panel needs reactive reads (so a toggle re-renders the layout) and a mutation that invalidates the cache. Add a small factory.

- [ ] **Step 1: Add a `settings` queryKey**

Edit `src/renderer/lib/queries.ts` — add a key inside the `queryKeys` object (after `annotations`):

```ts
export const queryKeys = {
  // ... existing keys above
  annotations: (captureId: string) => ['annotations', captureId] as const,
  settings: ['settings'] as const
}
```

- [ ] **Step 2: Add `settingsQueryOptions` + `useSettingsMutations`**

Append to `src/renderer/lib/queries.ts` (after `useNotesMutations`):

```ts
// --- Settings ---

export const settingsQueryOptions = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => window.birdbrain.settings.get()
})

export function useSettingsMutations() {
  const queryClient = useQueryClient()

  const update = useMutation({
    mutationFn: (partial: Partial<import('@shared/types').BirdbrainSettings>) =>
      window.birdbrain.settings.update(partial),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data)
    }
  })

  return { update }
}
```

The `setQueryData` on success avoids a refetch round-trip — the IPC return value is already the merged settings.

- [ ] **Step 3: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/lib/queries.ts
git commit -m "feat(queries): add settings query options and mutations"
```

---

## Task 3: Add `panelCollapsedForced` to `appStore`

**Files:**

- Modify: `src/renderer/stores/appStore.ts`

- [ ] **Step 1: Extend `AppState` interface**

Edit `src/renderer/stores/appStore.ts` — add field declaration (place near `commandPaletteOpen`):

```ts
interface AppState {
  // ... existing fields
  commandPaletteOpen: boolean
  panelCollapsedForced: boolean

  // ... existing setters
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  setPanelCollapsedForced: (forced: boolean) => void
  // ... rest unchanged
}
```

- [ ] **Step 2: Add initial value + setter to the `create` body**

```ts
export const useAppStore = create<AppState>((set) => ({
  // ... existing initial values
  commandPaletteOpen: false,
  panelCollapsedForced: false,

  // ... existing setters
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setPanelCollapsedForced: (forced) => set({ panelCollapsedForced: forced })
  // ... rest unchanged
}))
```

- [ ] **Step 3: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/stores/appStore.ts
git commit -m "feat(store): add panelCollapsedForced ephemeral flag"
```

---

## Task 4: `formatRelativeTime` util + unit test (TDD)

**Files:**

- Create: `src/renderer/lib/formatRelativeTime.ts`
- Test: `tests/lib/formatRelativeTime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/formatRelativeTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-02T12:00:00Z').getTime()

  it('returns "just now" for diffs under a minute', () => {
    expect(formatRelativeTime(new Date(now - 5_000).toISOString(), now)).toBe('just now')
    expect(formatRelativeTime(new Date(now - 59_000).toISOString(), now)).toBe('just now')
  })

  it('returns minute-grained strings under an hour', () => {
    expect(formatRelativeTime(new Date(now - 60_000).toISOString(), now)).toBe('1 minute ago')
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 minutes ago')
  })

  it('returns hour-grained strings under a day', () => {
    expect(formatRelativeTime(new Date(now - 60 * 60_000).toISOString(), now)).toBe('1 hour ago')
    expect(formatRelativeTime(new Date(now - 5 * 60 * 60_000).toISOString(), now)).toBe(
      '5 hours ago'
    )
  })

  it('returns day-grained strings under a week', () => {
    expect(formatRelativeTime(new Date(now - 24 * 60 * 60_000).toISOString(), now)).toBe(
      '1 day ago'
    )
  })

  it('returns absolute date for older diffs', () => {
    const old = new Date('2025-01-15T08:00:00Z').toISOString()
    const out = formatRelativeTime(old, now)
    expect(out).toMatch(/Jan 15, 2025/)
  })

  it('handles future-dated input as "just now"', () => {
    expect(formatRelativeTime(new Date(now + 5_000).toISOString(), now)).toBe('just now')
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```powershell
pnpm test --run tests/lib/formatRelativeTime.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/lib/formatRelativeTime.ts`:

```ts
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const ABSOLUTE_FMT = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})

export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diffMs = nowMs - ts
  if (diffMs < 60_000) return 'just now'
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return rtf.format(-diffHr, 'hour')
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return rtf.format(-diffDay, 'day')
  return ABSOLUTE_FMT.format(ts)
}
```

`Intl.RelativeTimeFormat` with `numeric: 'auto'` returns "1 minute ago" / "5 minutes ago" / "yesterday" idiomatically. The test expects "1 minute ago" exactly — `numeric: 'auto'` produces this for `-1`. If a future Node/Electron version drops "1 minute ago" for "a minute ago", update the test (not the impl).

- [ ] **Step 4: Re-run test, expect pass**

```powershell
pnpm test --run tests/lib/formatRelativeTime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/lib/formatRelativeTime.ts tests/lib/formatRelativeTime.test.ts
git commit -m "feat(lib): add formatRelativeTime util"
```

---

## Task 5: `useTimeTick` hook

**Files:**

- Create: `src/renderer/hooks/useTimeTick.ts`

Returns a number that bumps on a fixed interval so consumers re-render. No test (trivial wrapper around `setInterval`).

- [ ] **Step 1: Implement**

Create `src/renderer/hooks/useTimeTick.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * Bumps a counter every `intervalMs` so consumers that depend on the return
 * value re-render. Use this with `formatRelativeTime` to keep "Saved 2m ago"
 * surfaces fresh without each one owning its own interval.
 */
export function useTimeTick(intervalMs: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return tick
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/hooks/useTimeTick.ts
git commit -m "feat(hooks): add useTimeTick"
```

---

## Task 6: `useViewportWidth` hook + unit test

**Files:**

- Create: `src/renderer/hooks/useViewportWidth.ts`
- Test: `tests/hooks/useViewportWidth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useViewportWidth.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewportWidth } from '@renderer/hooks/useViewportWidth'

describe('useViewportWidth', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1280 })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns initial window.innerWidth synchronously', () => {
    const { result } = renderHook(() => useViewportWidth())
    expect(result.current).toBe(1280)
  })

  it('updates when the window emits resize', () => {
    const { result } = renderHook(() => useViewportWidth())
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, value: 800 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(800)
  })

  it('detaches resize listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useViewportWidth())
    unmount()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
```

If `tests/hooks/` doesn't exist, the test path will be created automatically.

If `@testing-library/react` is not yet a devDependency, install it first:

```powershell
pnpm add -D @testing-library/react
```

(Check `package.json` first; do not add if already present.)

If `vitest.config.ts` does not allow per-file `@vitest-environment jsdom`, fall back to `pnpm add -D jsdom` and inspect `vitest.config.ts` for an `environmentMatchGlobs`. Birdbrain's test suite runs through Electron's Node — keep this test file isolated to jsdom via the magic-comment.

- [ ] **Step 2: Run test, expect fail**

```powershell
pnpm test --run tests/hooks/useViewportWidth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/hooks/useViewportWidth.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * Returns the current viewport width, lazily initialized from `window.innerWidth`
 * (no flash on first paint) and updated on `resize` via a rAF-throttled handler
 * so Electron drag-resize doesn't fire setState every frame.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() => window.innerWidth)

  useEffect(() => {
    let frame = 0
    function onResize() {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setWidth(window.innerWidth)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return width
}
```

- [ ] **Step 4: Re-run test, expect pass**

```powershell
pnpm test --run tests/hooks/useViewportWidth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/hooks/useViewportWidth.ts tests/hooks/useViewportWidth.test.ts
git commit -m "feat(hooks): add useViewportWidth with rAF throttle"
```

---

## Task 7: `getProvenanceColor` helper

**Files:**

- Create: `src/renderer/components/captures/getProvenanceColor.ts`

Single source of truth for provenance shield/dot colors so breadcrumb + panel match.

- [ ] **Step 1: Implement**

Create `src/renderer/components/captures/getProvenanceColor.ts`:

```ts
import type { HashVerification } from '@shared/types'

export type ProvenanceStatus = HashVerification['status'] | undefined

interface ProvenanceColorTokens {
  text: string
  bg: string
  dot: string
  label: string
}

/**
 * Maps a verification status to Tailwind color tokens for the shield, dot, and
 * background. Status palette is intentionally raw (red/amber/emerald) — these
 * convey forensic state and don't theme-swap per `theme.md`.
 */
export function getProvenanceColor(status: ProvenanceStatus): ProvenanceColorTokens {
  switch (status) {
    case 'verified':
      return {
        text: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        dot: 'bg-emerald-400',
        label: 'Verified'
      }
    case 'tampered':
      return {
        text: 'text-red-400',
        bg: 'bg-red-500/10',
        dot: 'bg-red-400',
        label: 'Tampered'
      }
    case 'chain-broken':
      return {
        text: 'text-red-400',
        bg: 'bg-red-500/10',
        dot: 'bg-red-400',
        label: 'Chain broken'
      }
    case 'missing':
      return {
        text: 'text-amber-400',
        bg: 'bg-amber-500/10',
        dot: 'bg-amber-400',
        label: 'Missing'
      }
    case 'legacy':
      return {
        text: 'text-amber-400',
        bg: 'bg-amber-500/10',
        dot: 'bg-amber-400',
        label: 'Legacy HTML'
      }
    default:
      return {
        text: 'text-text-faint',
        bg: 'bg-surface',
        dot: 'bg-text-faint',
        label: 'Not verified'
      }
  }
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/captures/getProvenanceColor.ts
git commit -m "feat(captures): add getProvenanceColor helper"
```

---

## Task 8: `useVerifyMutation` hook

**Files:**

- Create: `src/renderer/components/captures/useVerifyMutation.ts`

Centralizes `captures.verify` so panel + breadcrumb (and later Forensics tab in PR1b) share `isPending` for the pulse animation, and so cache invalidation is consistent.

- [ ] **Step 1: Implement**

Create `src/renderer/components/captures/useVerifyMutation.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/queries'

export function useVerifyMutation(captureId: string, caseId: string) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationKey: ['verify-capture', captureId],
    mutationFn: () => window.birdbrain.captures.verify(captureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
    }
  })

  return {
    verify: () => mutation.mutate(),
    isPending: mutation.isPending,
    error: mutation.error
  }
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/captures/useVerifyMutation.ts
git commit -m "feat(captures): add useVerifyMutation hook"
```

---

## Task 9: `useCaptureTagEditor` hook + unit test (TDD)

**Files:**

- Create: `src/renderer/components/captures/useCaptureTagEditor.ts`
- Test: `tests/components/useCaptureTagEditor.test.ts`

Returns `{ tags, allTags, isLoading, toggleTag, createTag, removeTag }`. Pure state + mutations — no UI.

- [ ] **Step 1: Write the failing test**

Create `tests/components/useCaptureTagEditor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCaptureTagEditor } from '@renderer/components/captures/useCaptureTagEditor'

const captureId = 'cap-1'
const caseId = 'case-1'

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useCaptureTagEditor', () => {
  beforeEach(() => {
    ;(globalThis as any).window = (globalThis as any).window || {}
    ;(window as any).birdbrain = {
      tags: {
        list: vi.fn().mockResolvedValue([
          { id: 't1', name: 'foo', color: '#fff' },
          { id: 't2', name: 'bar', color: '#000' }
        ]),
        getForCapture: vi.fn().mockResolvedValue([{ id: 't1', name: 'foo', color: '#fff' }]),
        addToCapture: vi.fn().mockResolvedValue(undefined),
        removeFromCapture: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: 't3', name: 'new', color: '#abc' })
      }
    }
  })

  it('loads tags + capture tags', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCaptureTagEditor(captureId, caseId), {
      wrapper: withClient(client)
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.allTags.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(result.current.tags.map((t) => t.id)).toEqual(['t1'])
  })

  it('toggleTag adds when missing, removes when present', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCaptureTagEditor(captureId, caseId), {
      wrapper: withClient(client)
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.toggleTag('t2')
    })
    expect((window as any).birdbrain.tags.addToCapture).toHaveBeenCalledWith({
      captureId,
      tagId: 't2'
    })

    await act(async () => {
      await result.current.toggleTag('t1')
    })
    expect((window as any).birdbrain.tags.removeFromCapture).toHaveBeenCalledWith({
      captureId,
      tagId: 't1'
    })
  })

  it('createTag invokes tags.create with provided name + color', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCaptureTagEditor(captureId, caseId), {
      wrapper: withClient(client)
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.createTag('new', '#abc')
    })
    expect((window as any).birdbrain.tags.create).toHaveBeenCalledWith({
      name: 'new',
      color: '#abc'
    })
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```powershell
pnpm test --run tests/components/useCaptureTagEditor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/components/captures/useCaptureTagEditor.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import {
  tagsQueryOptions,
  tagsForCaptureQueryOptions,
  useTagsMutations
} from '@renderer/lib/queries'

export function useCaptureTagEditor(captureId: string, _caseId: string) {
  const tagsQuery = useQuery(tagsQueryOptions)
  const captureTagsQuery = useQuery(tagsForCaptureQueryOptions(captureId))
  const { addToCapture, removeFromCapture, create } = useTagsMutations()

  const allTags = tagsQuery.data ?? []
  const tags = captureTagsQuery.data ?? []
  const isLoading = tagsQuery.isLoading || captureTagsQuery.isLoading

  async function toggleTag(tagId: string) {
    const has = tags.some((t) => t.id === tagId)
    if (has) {
      await removeFromCapture.mutateAsync({ captureId, tagId })
    } else {
      await addToCapture.mutateAsync({ captureId, tagId })
    }
  }

  async function removeTag(tagId: string) {
    if (tags.some((t) => t.id === tagId)) {
      await removeFromCapture.mutateAsync({ captureId, tagId })
    }
  }

  async function createTag(name: string, color: string) {
    const tag = await create.mutateAsync({ name, color })
    if (tag?.id) {
      await addToCapture.mutateAsync({ captureId, tagId: tag.id })
    }
    return tag
  }

  return {
    tags,
    allTags,
    isLoading,
    toggleTag,
    removeTag,
    createTag,
    isToggling: addToCapture.isPending || removeFromCapture.isPending,
    isCreating: create.isPending
  }
}
```

- [ ] **Step 4: Re-run test, expect pass**

```powershell
pnpm test --run tests/components/useCaptureTagEditor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/captures/useCaptureTagEditor.ts tests/components/useCaptureTagEditor.test.ts
git commit -m "feat(captures): extract useCaptureTagEditor hook"
```

---

## Task 10: `TagEditorPopover` component

**Files:**

- Create: `src/renderer/components/captures/TagEditorPopover.tsx`

UI shell for the tag popover. Receives `captureId` + `caseId` and consumes `useCaptureTagEditor`. Closes on `selectedCaptureId` change is enforced by the parent unmounting/re-mounting; this component just trusts its props.

- [ ] **Step 1: Implement**

Create `src/renderer/components/captures/TagEditorPopover.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import { useCaptureTagEditor } from './useCaptureTagEditor'

interface Props {
  captureId: string
  caseId: string
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const COLOR_PRESETS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b']

export function TagEditorPopover({ captureId, caseId, open, onClose, anchorRef }: Props) {
  const { tags, allTags, toggleTag, createTag } = useCaptureTagEditor(captureId, caseId)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0])
  const [showColors, setShowColors] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose, anchorRef])

  if (!open) return null

  const available = allTags.filter((t) => !tags.some((ct) => ct.id === t.id))

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    await createTag(trimmed, color)
    setName('')
  }

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
    >
      {tags.length > 0 && (
        <div className="border-b border-border px-3 py-2">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
            Applied
          </div>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} onClick={() => toggleTag(tag.id)} removable />
            ))}
          </div>
        </div>
      )}

      <div className="max-h-40 overflow-y-auto py-1">
        {available.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-text-faint">No more tags to add.</div>
        )}
        {available.map((tag) => (
          <button
            key={tag.id}
            onClick={() => toggleTag(tag.id)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-elevated"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: tag.color || '#f59e0b' }}
            />
            {tag.name}
          </button>
        ))}
      </div>

      <div className="border-t border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowColors(!showColors)}
              className="flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110"
              style={{ backgroundColor: color }}
              title="Pick color"
            />
            {showColors && (
              <div className="absolute bottom-full left-0 mb-1 flex flex-col gap-1 rounded-lg border border-border-strong bg-card p-1.5 shadow-lg">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setColor(c)
                      setShowColors(false)
                    }}
                    className="h-4 w-4 rounded-full ring-1 ring-border hover:scale-110"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCreate()
              }
            }}
            placeholder="Create tag"
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim()}
            className="rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/captures/TagEditorPopover.tsx
git commit -m "feat(captures): add TagEditorPopover component"
```

---

## Task 11: `useInlineNoteEditor` hook + unit test

**Files:**

- Create: `src/renderer/components/captures/useInlineNoteEditor.ts`
- Test: `tests/components/useInlineNoteEditor.test.ts`

Encapsulates the inline-note state machine: latest-note pick, controlled-from-server-unless-dirty sync, debounce + blur + Cmd+Enter saves, Esc revert, pre-save flush.

- [ ] **Step 1: Write the failing test**

Create `tests/components/useInlineNoteEditor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Note } from '@shared/types'
import { useInlineNoteEditor } from '@renderer/components/captures/useInlineNoteEditor'

const captureTitle = 'My capture'

function note(id: string, body: string, updatedAt: string): Note {
  return {
    id,
    caseId: 'case-1',
    captureId: 'cap-1',
    title: 't',
    body,
    createdAt: updatedAt,
    updatedAt
  }
}

describe('useInlineNoteEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('picks latest-by-updatedAt note as the bound note', () => {
    const notes = [
      note('a', 'older', '2026-01-01T00:00:00Z'),
      note('b', 'newer', '2026-02-01T00:00:00Z')
    ]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    expect(result.current.boundNoteId).toBe('b')
    expect(result.current.value).toBe('newer')
  })

  it('blank blur with zero notes is a no-op', async () => {
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes: [], captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    await act(async () => {
      await result.current.flush('blur')
    })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('non-empty save with zero notes creates with auto-title = capture title', async () => {
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes: [], captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue('hello'))
    await act(async () => {
      await result.current.flush('blur')
    })
    expect(onCreate).toHaveBeenCalledWith({ title: captureTitle, body: 'hello' })
  })

  it('saving an existing note with cleared body persists empty body', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue(''))
    await act(async () => {
      await result.current.flush('blur')
    })
    expect(onUpdate).toHaveBeenCalledWith({ id: 'a', body: '' })
  })

  it('debounce save fires after 1500ms of inactivity', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue('typed'))
    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })
    expect(onUpdate).toHaveBeenCalledWith({ id: 'a', body: 'typed' })
  })

  it('Esc reverts to last saved value', () => {
    const notes = [note('a', 'original', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue('changed'))
    expect(result.current.value).toBe('changed')
    act(() => result.current.revert())
    expect(result.current.value).toBe('original')
  })

  it('does not stomp local edits when external update lands without our save', async () => {
    const initial = [note('a', 'server', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ notes }: { notes: Note[] }) =>
        useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate }),
      { initialProps: { notes: initial } }
    )
    act(() => result.current.setValue('local typing'))
    rerender({
      notes: [note('a', 'server-updated', '2026-02-01T00:01:00Z')]
    })
    expect(result.current.value).toBe('local typing')
  })

  it('syncs from server when local is clean and server bumps updatedAt', () => {
    const initial = [note('a', 'server', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ notes }: { notes: Note[] }) =>
        useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate }),
      { initialProps: { notes: initial } }
    )
    expect(result.current.value).toBe('server')
    rerender({
      notes: [note('a', 'server-updated', '2026-02-01T00:01:00Z')]
    })
    expect(result.current.value).toBe('server-updated')
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```powershell
pnpm test --run tests/components/useInlineNoteEditor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/components/captures/useInlineNoteEditor.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'

const DEBOUNCE_MS = 1500

interface CreateArgs {
  title: string
  body: string
}

interface UpdateArgs {
  id: string
  body: string
}

export interface UseInlineNoteEditorArgs {
  notes: Note[]
  captureId: string
  captureTitle: string
  onCreate: (args: CreateArgs) => Promise<unknown>
  onUpdate: (args: UpdateArgs) => Promise<unknown>
}

export type FlushSource = 'blur' | 'cmd-enter' | 'debounce' | 'switch'

function pickLatest(notes: Note[], captureId: string): Note | null {
  const filtered = notes.filter((n) => n.captureId === captureId)
  if (filtered.length === 0) return null
  return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export function useInlineNoteEditor({
  notes,
  captureId,
  captureTitle,
  onCreate,
  onUpdate
}: UseInlineNoteEditorArgs) {
  const latest = pickLatest(notes, captureId)
  const boundNoteId = latest?.id ?? null

  // The last server body we observed for the bound note. Used to detect dirty
  // state vs server, and to revert via Esc.
  const lastServerBodyRef = useRef<string>(latest?.body ?? '')
  const lastServerUpdatedRef = useRef<string>(latest?.updatedAt ?? '')
  const lastBoundIdRef = useRef<string | null>(boundNoteId)

  const [value, setValue] = useState<string>(latest?.body ?? '')
  const debounceRef = useRef<number | null>(null)

  // Server -> local sync: only when bound note id changes, or when the note's
  // updatedAt advances AND we have no local diff vs the prior server body.
  useEffect(() => {
    if (lastBoundIdRef.current !== boundNoteId) {
      lastBoundIdRef.current = boundNoteId
      lastServerBodyRef.current = latest?.body ?? ''
      lastServerUpdatedRef.current = latest?.updatedAt ?? ''
      setValue(latest?.body ?? '')
      return
    }
    if (!latest) return
    const advanced = latest.updatedAt > lastServerUpdatedRef.current
    const localClean = value === lastServerBodyRef.current
    if (advanced && localClean) {
      lastServerBodyRef.current = latest.body
      lastServerUpdatedRef.current = latest.updatedAt
      setValue(latest.body)
    }
  }, [latest, boundNoteId, value])

  const flush = useCallback(
    async (_source: FlushSource): Promise<void> => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const current = value
      // Existing note: persist whatever the user has, even empty (no silent delete).
      if (boundNoteId) {
        if (current === lastServerBodyRef.current) return
        lastServerBodyRef.current = current
        await onUpdate({ id: boundNoteId, body: current })
        return
      }
      // No note: blank blur is a no-op.
      const trimmed = current.trim()
      if (trimmed.length === 0) return
      await onCreate({ title: captureTitle, body: current })
    },
    [boundNoteId, captureTitle, onCreate, onUpdate, value]
  )

  // Debounce on every value change.
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    if (boundNoteId === null && value.trim().length === 0) return
    if (boundNoteId !== null && value === lastServerBodyRef.current) return
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void flush('debounce')
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [value, boundNoteId, flush])

  const revert = useCallback(() => {
    setValue(lastServerBodyRef.current)
  }, [])

  const isDirty =
    boundNoteId === null ? value.trim().length > 0 : value !== lastServerBodyRef.current

  return {
    value,
    setValue,
    flush,
    revert,
    isDirty,
    boundNoteId,
    savedAt: latest?.updatedAt ?? null
  }
}
```

- [ ] **Step 4: Re-run test, expect pass**

```powershell
pnpm test --run tests/components/useInlineNoteEditor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/captures/useInlineNoteEditor.ts tests/components/useInlineNoteEditor.test.ts
git commit -m "feat(captures): add useInlineNoteEditor hook"
```

---

## Task 12: `CaptureDetailsPanel` component

**Files:**

- Create: `src/renderer/components/captures/CaptureDetailsPanel.tsx`

Renders Header, Metadata, Tags, Notes sections. Receives the `capture` plus callbacks for delete/add-note (which the route mounts at viewer level).

- [ ] **Step 1: Implement**

Create `src/renderer/components/captures/CaptureDetailsPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Star,
  ExternalLink,
  Download,
  Trash2,
  Globe,
  Calendar,
  Folder,
  FileType,
  Shield,
  Plus,
  StickyNote
} from 'lucide-react'
import type { Capture } from '@shared/types'
import { caseQueryOptions, notesQueryOptions, useNotesMutations } from '@renderer/lib/queries'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import { presets } from '@renderer/lib/motion/presets'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'
import { TagBadge } from '@renderer/components/tags/TagBadge'
import { TagEditorPopover } from './TagEditorPopover'
import { useCaptureTagEditor } from './useCaptureTagEditor'
import { useInlineNoteEditor } from './useInlineNoteEditor'
import { useVerifyMutation } from './useVerifyMutation'
import { getProvenanceColor } from './getProvenanceColor'

interface Props {
  capture: Capture
  caseId: string
  onDownload: () => void
  onOpenExternal: () => void
  onDelete: () => void
  onOpenAddNote: () => void
}

export function CaptureDetailsPanel({
  capture,
  caseId,
  onDownload,
  onOpenExternal,
  onDelete,
  onOpenAddNote
}: Props) {
  const reduce = useReduceMotion()
  const tick = useTimeTick(60_000)
  const { data: caseData } = useQuery(caseQueryOptions(caseId))
  const { data: notes = [] } = useQuery(notesQueryOptions(caseId))
  const { create: createNote, update: updateNote } = useNotesMutations(caseId)
  const { favorites, toggleFavorite } = useFavorites(caseId)
  const { tags } = useCaptureTagEditor(capture.id, caseId)
  const verify = useVerifyMutation(capture.id, caseId)

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const tagAnchorRef = useRef<HTMLButtonElement>(null)

  // Close tag popover on capture switch.
  useEffect(() => {
    setTagPopoverOpen(false)
  }, [capture.id])

  const captureNotes = notes.filter((n) => n.captureId === capture.id)
  const noteCount = captureNotes.length

  const inline = useInlineNoteEditor({
    notes: captureNotes,
    captureId: capture.id,
    captureTitle: capture.title || '',
    onCreate: async ({ title, body }) => {
      await createNote.mutateAsync({
        caseId,
        captureId: capture.id,
        title,
        body,
        sourceUrl: capture.url
      })
    },
    onUpdate: async ({ id, body }) => {
      await updateNote.mutateAsync({ id, body })
    }
  })

  const isFavorite = favorites.has(capture.id)
  const provenance = getProvenanceColor(capture.lastVerifiedStatus)

  let hostname = capture.url
  try {
    hostname = new URL(capture.url).hostname
  } catch {
    /* keep raw url */
  }

  const animationProps = reduce
    ? {}
    : {
        initial: presets.fadeUp.initial,
        animate: presets.fadeUp.animate,
        transition: presets.fadeUp.transition
      }

  // Saved-at re-renders with `tick` so "Saved 2m ago" stays fresh.
  void tick

  async function handleAddNote() {
    if (inline.isDirty) {
      await inline.flush('switch')
    }
    onOpenAddNote()
  }

  return (
    <motion.div
      key={capture.id}
      {...animationProps}
      className="flex h-full flex-col overflow-y-auto"
    >
      {/* Header */}
      <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-text-primary">
            Capture Details
          </h2>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => toggleFavorite(capture.id)}
              title={isFavorite ? 'Unfavorite' : 'Favorite'}
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <Star
                className={`h-3.5 w-3.5 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
              />
            </button>
            <button
              onClick={onOpenExternal}
              title="Open URL"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDownload}
              title="Download capture"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              title="Delete capture"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Metadata grid */}
      <section className="space-y-3.5 border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <MetadataRow
          icon={<Globe className="h-3.5 w-3.5" />}
          label="Source"
          value={
            <button
              onClick={onOpenExternal}
              className="truncate text-left text-text-secondary hover:text-accent"
              title={capture.url}
            >
              {hostname}
            </button>
          }
        />
        <MetadataRow
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="Captured"
          value={
            <span title={new Date(capture.timestamp).toLocaleString()}>
              {formatRelativeTime(capture.timestamp)}
            </span>
          }
        />
        <MetadataRow
          icon={<Folder className="h-3.5 w-3.5" />}
          label="Case"
          value={
            <Link
              to="/cases/$caseId"
              params={{ caseId }}
              className="text-text-secondary hover:text-accent"
            >
              {caseData?.name ?? '—'}
            </Link>
          }
        />
        <MetadataRow
          icon={<FileType className="h-3.5 w-3.5" />}
          label="Type"
          value={capture.format === 'mhtml' ? 'MHTML Archive' : 'HTML Page'}
        />
        <MetadataRow
          icon={<Shield className={`h-3.5 w-3.5 ${provenance.text}`} />}
          label="Provenance"
          value={
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${provenance.dot} ${
                  verify.isPending ? 'animate-pulse' : ''
                }`}
              />
              <span className={provenance.text}>{provenance.label}</span>
              <button
                onClick={verify.verify}
                disabled={verify.isPending}
                className="ml-auto rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle disabled:opacity-50"
              >
                {verify.isPending ? 'Verifying…' : 'Re-verify'}
              </button>
            </div>
          }
        />
      </section>

      {/* Tags */}
      <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
            Tags
          </span>
          <div className="relative">
            <button
              ref={tagAnchorRef}
              onClick={() => setTagPopoverOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
            <TagEditorPopover
              captureId={capture.id}
              caseId={caseId}
              open={tagPopoverOpen}
              onClose={() => setTagPopoverOpen(false)}
              anchorRef={tagAnchorRef}
            />
          </div>
        </div>
        {tags.length === 0 ? (
          <p className="text-[11px] text-text-faint">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        )}
      </section>

      {/* Notes */}
      <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
              Notes
            </span>
            {noteCount > 1 && (
              <span className="rounded-full bg-accent-subtle px-1.5 text-[10px] font-semibold text-accent">
                {noteCount} notes
              </span>
            )}
          </div>
          <button
            onClick={handleAddNote}
            title="New note"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          data-testid="inline-note-textarea"
          value={inline.value}
          onChange={(e) => inline.setValue(e.target.value)}
          onBlur={() => void inline.flush('blur')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              inline.revert()
              ;(e.target as HTMLTextAreaElement).blur()
            }
            if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) === true) {
              e.preventDefault()
              void inline.flush('cmd-enter')
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
          placeholder="Add a quick note…"
          rows={4}
          className="w-full resize-none rounded-md border border-border bg-canvas p-2 text-xs text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {inline.savedAt && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-text-faint">
            <StickyNote className="h-3 w-3" />
            Saved {formatRelativeTime(inline.savedAt)}
          </p>
        )}
      </section>
    </motion.div>
  )
}

function MetadataRow({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
          {label}
        </div>
        <div className="text-xs text-text-secondary">{value}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/captures/CaptureDetailsPanel.tsx
git commit -m "feat(captures): add CaptureDetailsPanel component"
```

---

## Task 13: `CaptureDetailsRail` component

**Files:**

- Create: `src/renderer/components/captures/CaptureDetailsRail.tsx`

40px-wide collapsed view. Shows expand chevron (hidden when forced), Star toggle, External, Tag-count, Note-count.

- [ ] **Step 1: Implement**

Create `src/renderer/components/captures/CaptureDetailsRail.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Star, ExternalLink, Tag as TagIcon, StickyNote } from 'lucide-react'
import type { Capture } from '@shared/types'
import { notesQueryOptions, tagsForCaptureQueryOptions } from '@renderer/lib/queries'
import { useFavorites } from '@renderer/hooks/useFavorites'

interface Props {
  capture: Capture
  caseId: string
  forced: boolean
  onExpand: () => void
  onOpenExternal: () => void
}

export function CaptureDetailsRail({ capture, caseId, forced, onExpand, onOpenExternal }: Props) {
  const { data: tags = [] } = useQuery(tagsForCaptureQueryOptions(capture.id))
  const { data: notes = [] } = useQuery(notesQueryOptions(caseId))
  const { favorites, toggleFavorite } = useFavorites(caseId)
  const isFavorite = favorites.has(capture.id)
  const noteCount = notes.filter((n) => n.captureId === capture.id).length

  const tooltipForced = forced ? 'Resize window to expand details' : undefined
  const disabledClick = forced ? undefined : onExpand

  return (
    <div className="flex h-full w-10 flex-col items-center gap-1 py-2" title={tooltipForced}>
      {!forced && (
        <button
          onClick={onExpand}
          title="Expand details"
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={() => toggleFavorite(capture.id)}
        title={isFavorite ? 'Unfavorite' : 'Favorite'}
        className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-elevated ${
          forced ? 'opacity-50 cursor-default' : ''
        }`}
        disabled={forced}
      >
        <Star
          className={`h-3.5 w-3.5 ${
            isFavorite ? 'fill-amber-400 text-amber-400' : 'text-text-muted'
          }`}
        />
      </button>
      <button
        onClick={onOpenExternal}
        title="Open URL"
        className={`flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary ${
          forced ? 'opacity-50 cursor-default' : ''
        }`}
        disabled={forced}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={disabledClick}
        title={forced ? tooltipForced : `${tags.length} tags`}
        className={`relative flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary ${
          forced ? 'opacity-50 cursor-default' : ''
        }`}
        disabled={forced}
      >
        <TagIcon className="h-3.5 w-3.5" />
        {tags.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent-subtle px-1 text-[9px] font-semibold leading-none text-accent">
            {tags.length}
          </span>
        )}
      </button>
      <button
        onClick={disabledClick}
        title={forced ? tooltipForced : `${noteCount} notes`}
        className={`relative flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary ${
          forced ? 'opacity-50 cursor-default' : ''
        }`}
        disabled={forced}
      >
        <StickyNote className="h-3.5 w-3.5" />
        {noteCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent-subtle px-1 text-[9px] font-semibold leading-none text-accent">
            {noteCount}
          </span>
        )}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/captures/CaptureDetailsRail.tsx
git commit -m "feat(captures): add CaptureDetailsRail collapsed view"
```

---

## Task 14: Refactor `CaptureViewer` — slim breadcrumb + drop Analysis tab + expose action callbacks

**Files:**

- Modify: `src/renderer/components/captures/CaptureViewer.tsx`

This is the largest single edit. Strip the existing header (tag popover, ProvenanceBadge, Download/External/MoreHorizontal cluster, overflow menu). Replace with a slim breadcrumb. Drop `'analysis'` and `'metadata'` references; keep `'metadata'` tab for now (Forensics rebuild is PR1b — leave the existing 4-row body in place but rename label is also PR1b). Drop `'analysis'` only.

Expose `openAddNote` + `openDeleteConfirm` via a context (or via a small ref-forwarding pattern) so the panel can trigger them.

The simplest approach: hoist `showDeleteConfirm` and `showAddNote` into the route component (`captures.tsx`), pass setters down to both `CaptureViewer` and `CaptureDetailsPanel`. Refactor inline.

This step rewrites large chunks of `CaptureViewer.tsx` — read the file first to confirm the current line numbers haven't drifted from those quoted in the design doc.

- [ ] **Step 1: Hoist Add-Note / Delete-Confirm dialogs to a shared owner**

The route already wraps both viewer and panel, so route-level hosting is the natural fit. We'll add a dedicated wrapper component (`CaptureWorkspace`) inside `captures.tsx` (Task 15) that owns these two dialogs and passes openers to both children. For Task 14, focus only on `CaptureViewer.tsx`.

- [ ] **Step 2: Replace `CaptureViewer.tsx` header + tabs**

Edit `src/renderer/components/captures/CaptureViewer.tsx`:

1. Update tab type definitions (lines 45–65) — remove `'analysis'`:

```ts
type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'metadata'

const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'metadata']

const TAB_ICONS: Record<ViewTab, typeof Image> = {
  screenshot: Image,
  page: Globe,
  source: Code,
  text: FileText,
  metadata: Info
}

const TAB_LABELS: Record<ViewTab, string> = {
  screenshot: 'Screenshot',
  page: 'Page',
  source: 'Source',
  text: 'Text',
  metadata: 'Metadata'
}
```

2. Drop unused imports: `Sparkles`, `MoreHorizontal`, `StickyNote`, `Trash2`, `Download`, `ExternalLink`, `Tag as TagIcon`, `ProvenanceBadge`, `AnalysisTab`, `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `AddNoteModal` (these will live at the route level).

3. Replace the import block (lines 1–43) with:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { capturesQueryOptions } from '@renderer/lib/queries'
import type { Capture } from '@shared/types'
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Image,
  Globe,
  Code,
  FileText,
  Info,
  Shield
} from 'lucide-react'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { AnnotationEditor } from './annotation/AnnotationEditor'
import { Button } from '@renderer/components/ui'
import { getProvenanceColor } from './getProvenanceColor'
```

4. Drop these state variables from the component body (lines 80–88): `showTagMenu`, `showDeleteConfirm`, `showAddNote`, `showOverflowMenu`, `newTagName`, `newTagColor`, `showColorPicker`, `notePrefillTitle`, `notePrefillBody`. Drop the matching mutations (`useTagsMutations`, `useCapturesMutations`) — they'll move to the route + panel.

5. Drop `handleToggleTag`, `handleDelete`, `handleDownload`, `handleOpenExternal` from inside `CaptureViewer`. Keep navigation (`goPrev`, `goNext`, current-index logic, `← →` keyboard handler).

6. Replace the entire `<main>` body (lines 209–571 — old header, tag popover, action cluster, sub-tabs row, metadata grid, analysis branch, dialog, AddNoteModal). Keep the sub-tabs row (it remains) and content branches for `screenshot/page/source/text/metadata`. Drop the `analysis` branch entirely.

The rewritten `<main>` body looks like this:

```tsx
return (
  <main className="flex flex-1 flex-col overflow-hidden bg-canvas">
    {/* Slim breadcrumb */}
    <div className="flex h-9 items-center gap-2 border-b border-border px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => useAppStore.getState().setSelectedCaptureId(null)}
        title="Back"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Button>
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium text-text-primary">
          {capture.title || hostname}
        </span>
      </div>
      <Shield
        className={`h-3.5 w-3.5 ${getProvenanceColor(capture.lastVerifiedStatus).text}`}
        aria-label={getProvenanceColor(capture.lastVerifiedStatus).label}
      />
      <Button variant="ghost" size="icon-sm" onClick={goPrev} disabled={currentIndex <= 0}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="shrink-0 text-[11px] text-text-faint">
        {currentIndex + 1} / {captures.length}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={goNext}
        disabled={currentIndex >= captures.length - 1}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <span className="shrink-0 text-[11px] text-text-faint">← →</span>
    </div>

    {/* Sub-tabs row (unchanged) */}
    <div className="flex items-center gap-1 border-b border-border bg-surface px-3">
      {TABS.map((tab) => {
        const Icon = TAB_ICONS[tab]
        const isActive = activeTab === tab
        return (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors ${
              isActive ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {TAB_LABELS[tab]}
            {isActive && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent" />
            )}
          </button>
        )
      })}
    </div>

    {/* Content area — keep existing branches except analysis */}
    <div className="flex-1 overflow-hidden min-h-0">
      {activeTab === 'screenshot' &&
        (content ? (
          <ScreenshotTabPanel
            captureId={capture.id}
            imageUrl={`data:image/png;base64,${content}`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="text-sm text-text-muted">No screenshot available</p>
            <p className="text-xs text-text-faint">
              Screenshot may not have been captured or exceeded the size limit.
            </p>
          </div>
        ))}
      {activeTab === 'page' && capture.format === 'mhtml' ? (
        <div className="h-full w-full overflow-hidden">
          <MhtmlViewer captureId={capture.id} />
        </div>
      ) : activeTab === 'page' ? (
        content ? (
          <iframe
            sandbox=""
            srcDoc={content}
            className="h-full w-full border-0 bg-white"
            title="Archived page"
          />
        ) : (
          <div className="p-4 text-text-muted">No HTML available</div>
        )
      ) : null}
      {activeTab === 'source' &&
        (content ? (
          <div className="h-full overflow-y-auto p-4">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-muted">
              {content}
            </pre>
          </div>
        ) : (
          <div className="p-4 text-text-muted">No HTML available</div>
        ))}
      {activeTab === 'text' &&
        (content ? (
          <div className="h-full overflow-y-auto p-4">
            <pre className="whitespace-pre-wrap font-mono text-sm text-text-muted">{content}</pre>
          </div>
        ) : (
          <div className="p-4 text-text-muted">No text content available</div>
        ))}
      {activeTab === 'metadata' && (
        <div className="h-full overflow-y-auto p-4">
          <div className="space-y-3 font-mono text-sm">
            <MetadataRow label="URL" value={capture.url} />
            <MetadataRow label="Timestamp" value={new Date(capture.timestamp).toLocaleString()} />
            <MetadataRow label="Hash (SHA-256)" value={capture.hash} />
            <MetadataRow label="Created" value={new Date(capture.createdAt).toLocaleString()} />
            {capture.headers && (
              <div>
                <div className="text-text-muted">Headers</div>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-text-muted">
                  {capture.headers}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  </main>
)
```

7. Keep the `MetadataRow` helper at the bottom of the file untouched.

8. Keep `ScreenshotTabPanel` (the inline function definition starting around line 582) untouched — it stays for PR2.

- [ ] **Step 3: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS — no broken imports.

- [ ] **Step 4: Run unit tests**

```powershell
pnpm test --run
```

Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/captures/CaptureViewer.tsx
git commit -m "refactor(viewer): replace header with slim breadcrumb, drop analysis tab"
```

---

## Task 15: Three-column route layout (`captures.tsx`) + delete/add-note dialog hosting

**Files:**

- Modify: `src/renderer/routes/cases/$caseId/captures.tsx`

Replace the current `CapturesRoute` with a wrapper that owns the delete dialog + add-note modal, manages forced-collapse based on `useViewportWidth`, reads `detailsPanelCollapsed` from settings, and renders the panel/rail.

- [ ] **Step 1: Rewrite the route component**

Replace the entire contents of `src/renderer/routes/cases/$caseId/captures.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  capturesQueryOptions,
  settingsQueryOptions,
  useCapturesMutations,
  useSettingsMutations
} from '@renderer/lib/queries'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { CaptureDetailsPanel } from '@renderer/components/captures/CaptureDetailsPanel'
import { CaptureDetailsRail } from '@renderer/components/captures/CaptureDetailsRail'
import { AddNoteModal } from '@renderer/components/notes/AddNoteModal'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui'
import { useAppStore } from '@renderer/stores/appStore'
import { useViewportWidth } from '@renderer/hooks/useViewportWidth'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'

const COLLAPSE_THRESHOLD = 1100

export function CapturesRoute() {
  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const setSelectedCaptureId = useAppStore((s) => s.setSelectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const setPanelCollapsedForced = useAppStore((s) => s.setPanelCollapsedForced)
  const panelCollapsedForced = useAppStore((s) => s.panelCollapsedForced)

  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: settings } = useQuery(settingsQueryOptions)
  const { update: updateSettings } = useSettingsMutations()
  const { remove: removeCapture } = useCapturesMutations(caseId)
  const reduceMotion = useReduceMotion()
  const viewportWidth = useViewportWidth()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)

  // Sync forced flag from viewport width.
  useEffect(() => {
    setPanelCollapsedForced(viewportWidth < COLLAPSE_THRESHOLD)
  }, [viewportWidth, setPanelCollapsedForced])

  const userPref = settings?.detailsPanelCollapsed ?? false
  const panelDisplayedCollapsed = panelCollapsedForced || userPref

  const selectedCapture = useMemo(
    () => captures.find((c) => c.id === selectedCaptureId) ?? null,
    [captures, selectedCaptureId]
  )

  function toggleUserPref() {
    updateSettings.mutate({ detailsPanelCollapsed: !userPref })
  }

  async function handleDelete() {
    if (!selectedCaptureId) return
    const id = selectedCaptureId
    await removeCapture.mutateAsync(id)
    setShowDeleteConfirm(false)
    const remaining = captures.filter((c) => c.id !== id)
    if (remaining.length > 0) {
      selectCapture(remaining[0].id)
    } else {
      setSelectedCaptureId(null)
    }
  }

  async function handleDownload() {
    if (!selectedCaptureId) return
    await window.birdbrain.captures.download(selectedCaptureId)
  }

  async function handleOpenExternal() {
    if (!selectedCapture) return
    await window.birdbrain.captures.openExternal(selectedCapture.url)
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <div className="w-[280px] shrink-0 overflow-y-auto border-r border-border">
        <CaptureList caseId={caseId} />
      </div>
      <div className="flex flex-1 min-w-0 overflow-hidden">
        <CaptureViewer />
      </div>
      {selectedCapture && (
        <aside
          data-testid="capture-details-aside"
          className={`shrink-0 overflow-hidden border-l border-border bg-surface ${
            reduceMotion ? '' : 'transition-[width] duration-150'
          } ${panelDisplayedCollapsed ? 'w-10' : 'w-[400px] min-w-[400px]'}`}
        >
          {panelDisplayedCollapsed ? (
            <CaptureDetailsRail
              capture={selectedCapture}
              caseId={caseId}
              forced={panelCollapsedForced}
              onExpand={toggleUserPref}
              onOpenExternal={handleOpenExternal}
            />
          ) : (
            <CaptureDetailsPanel
              capture={selectedCapture}
              caseId={caseId}
              onDownload={handleDownload}
              onOpenExternal={handleOpenExternal}
              onDelete={() => setShowDeleteConfirm(true)}
              onOpenAddNote={() => setShowAddNote(true)}
            />
          )}
        </aside>
      )}

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent onClose={() => setShowDeleteConfirm(false)} className="w-80 max-w-80 p-5">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-sm">Delete Capture?</DialogTitle>
            <DialogDescription className="text-xs">
              This will permanently remove the capture and its files. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {selectedCapture && (
        <AddNoteModal
          open={showAddNote}
          caseId={caseId}
          captureId={selectedCapture.id}
          captureTitle={selectedCapture.title || ''}
          captureUrl={selectedCapture.url}
          onClose={() => setShowAddNote(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Build**

```powershell
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/routes/cases/$caseId/captures.tsx
git commit -m "feat(routes): three-column captures layout with details panel + rail"
```

---

## Task 16: Manual smoke test in dev mode

**Files:** none

- [ ] **Step 1: Launch dev**

```powershell
pnpm dev
```

- [ ] **Step 2: Verify scenarios**

Walk through these manually (caveat: panel renders only when a capture is selected):

1. Open a case that has captures.
2. Click a capture in the list → panel appears at 400px on the right.
3. Toggle Star → favorite icon fills amber and persists across capture-switch.
4. Click External → browser opens the URL.
5. Click Download → save dialog opens.
6. Click "+" near Tags → popover opens, type a name + Enter creates tag and applies it.
7. Click "+" near Notes → AddNoteModal opens with title prefilled.
8. Type into the inline-note textarea → after 1.5s of inactivity, the saved-at line bumps. Blur to force save.
9. Esc in the textarea reverts.
10. Click Re-verify → both shields (breadcrumb + panel) pulse, then settle on new color.
11. Resize the window below 1100px → panel collapses to 40px rail; expand chevron disappears.
12. Resize back above 1100px → panel restores.
13. Click capture's chevron toggle (collapse manually) → panel collapses; setting persists across reload.
14. Switch to a different capture → panel content updates, scroll position is preserved.

If any step fails, fix the underlying code and re-run the smoke before continuing. Take screenshots / a short GIF and attach to the eventual PR description.

---

## Task 17: e2e — `capture-detail-panel.spec.ts`

**Files:**

- Create: `e2e/capture-detail-panel.spec.ts`

- [ ] **Step 1: Look at an existing spec to crib fixtures + helpers**

Read `e2e/notes.spec.ts` to see the pattern for: launching the Electron app, creating a case, capturing a capture, locating UI elements. Use `data-testid` attributes — `capture-details-aside` is added in Task 15; `inline-note-textarea` is added in Task 12.

- [ ] **Step 2: Implement**

Create `e2e/capture-detail-panel.spec.ts` modeled on the existing patterns. Skeleton:

```ts
import { test, expect } from './fixtures'

test('panel renders for selected capture, collapses below 1100px', async ({ app }) => {
  // Setup: assume fixture seeds a case + an MHTML capture and selects it.
  await app.goto('/cases/' + app.seededCaseId + '/captures')
  await app.selectFirstCapture()

  const aside = app.page.getByTestId('capture-details-aside')
  await expect(aside).toBeVisible()
  await expect(aside).toHaveCSS('width', '400px')

  // Toggle favorite and verify it stays after capture-switch.
  await app.page.getByTitle('Favorite').click()
  await app.selectFirstCapture()
  await expect(app.page.locator('button[title="Unfavorite"]')).toBeVisible()

  // Inline note: type, blur, expect saved-at hint.
  const textarea = app.page.getByTestId('inline-note-textarea')
  await textarea.fill('hello from e2e')
  await textarea.blur()
  await expect(app.page.getByText(/Saved/)).toBeVisible()

  // Narrow viewport → forced rail; expand chevron hidden.
  await app.window.setBounds({ width: 1000, height: 800 })
  await expect(aside).toHaveCSS('width', '40px')
  await expect(app.page.getByTitle('Expand details')).toHaveCount(0)

  // Restore wide viewport → user pref still expanded.
  await app.window.setBounds({ width: 1280, height: 800 })
  await expect(aside).toHaveCSS('width', '400px')
})
```

(If the existing fixtures don't expose `selectFirstCapture` / `seededCaseId`, mirror the equivalent helpers from `notes.spec.ts`. The exact API is repo-local.)

- [ ] **Step 3: Build the app for e2e**

```powershell
pnpm build
```

- [ ] **Step 4: Run the spec**

```powershell
pnpm test:e2e e2e/capture-detail-panel.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add e2e/capture-detail-panel.spec.ts
git commit -m "test(e2e): cover capture detail panel layout, favorites, inline notes, forced collapse"
```

---

## Task 18: Final pass — lint, typecheck, full test run, dev smoke

**Files:** none

- [ ] **Step 1: Lint**

```powershell
pnpm lint
```

Expected: PASS. Fix anything reported (no `any`, no unused vars).

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Full test run**

```powershell
pnpm test --run
pnpm test:e2e
```

Expected: PASS.

- [ ] **Step 4: Dev smoke once more**

```powershell
pnpm dev
```

Walk through the same checklist from Task 16.

---

## Task 19: Open the PR

**Files:** none

- [ ] **Step 1: Push**

```powershell
git push -u origin feat/capture-detail-pr1a
```

- [ ] **Step 2: Open PR**

```powershell
gh pr create --title "feat(captures): redesign capture detail with three-column panel (PR1a)" --body "$(cat <<'EOF'
## Summary
- Three-column captures layout (list / viewer / 400px right panel) with responsive 40px rail under 1100px.
- New `CaptureDetailsPanel` exposing favorite/external/download/delete, metadata, tags (extracted hook + popover), and inline note editor with debounce + blur + Cmd+Enter saves.
- Slim breadcrumb in `CaptureViewer` replacing the old header cluster; Analysis tab hidden.
- `detailsPanelCollapsed` + `tooltipsSeen` settings keys with Zod `.default()` migration.

## Test plan
- [ ] `pnpm lint` passes.
- [ ] `pnpm test --run` passes.
- [ ] `pnpm test:e2e e2e/capture-detail-panel.spec.ts` passes.
- [ ] Manual smoke: select capture → panel renders → favorite/external/download/delete work; tag popover create + toggle; inline note debounce save + blur + Cmd+Enter + Esc revert; re-verify pulses both shields; resize below/above 1100px.

Plan: docs/plans/capture-detail-redesign.md (PR1a section).

Matt Donovan - mattddonovan@proton.me
EOF
)"
```

- [ ] **Step 3: Capture the PR URL**

Print the PR URL in the final summary.

---

## Out of scope for PR1a (separate plans)

- **PR1b — Forensics tab rebuild.** Rename `metadata` → `forensics`, expand to six sections (legacy banner, hash chain, identity, capture environment, operator, headers), share `useVerifyMutation` with the panel.
- **PR2 — Screenshot polish.** `ScreenshotZoomBar` lift, browser-chrome wrapper, `AnnotationToolbar` restyle, drop `editing` gate, draw-tool auto-shows overlay, one-time tooltip via `tooltipsSeen`.

Each ships as a separate impl plan referencing the same design doc.

---

## Self-review notes

- Spec coverage: every PR1a requirement in `capture-detail-redesign.md` §3, §6 (PR1a column), §10 (PR 1a section), §11 decisions 19–50 maps to a task above. Forensics rebuild (§8) and screenshot polish (§5) are intentionally deferred.
- Type consistency: `useCaptureTagEditor` returns `tags`/`allTags`/`toggleTag`/`createTag`/`removeTag` — the same names are consumed by `TagEditorPopover` and `CaptureDetailsPanel`. `useInlineNoteEditor` returns `value`/`setValue`/`flush`/`revert`/`isDirty`/`boundNoteId`/`savedAt` — the panel consumes the same names. `useVerifyMutation` returns `verify`/`isPending`/`error` — panel uses those exact fields.
- Risks worth flagging during review: (1) the `CaptureViewer.tsx` strip is a destructive delete of dead UI state — make sure no other component imports the removed mutations from there; (2) the inline-note debounce timer uses `window.setTimeout` which is correct in Electron renderer but needs verification under jsdom in unit tests (covered by `useInlineNoteEditor.test.ts`); (3) e2e fixtures may need a small extension if they don't already expose `selectFirstCapture` — be prepared to add that helper.
