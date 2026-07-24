# Workspace-Centric UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Birdbrain from a dashboard-centric app (always landing on "Welcome to Birdbrain") into a workspace-centric IDE-like app where the active case IS the workspace, with session restoration, a vertical icon sidebar, a command palette for case switching, and case metadata merged into a collapsible header.

**Architecture:** The app gains three new behavioral layers: (1) session persistence via `BirdbrainSettings` storing `lastActiveCaseId` + `lastActiveSection`, (2) a redirect-on-mount hook that auto-restores the last workspace, and (3) a new layout model replacing the horizontal tab bar with a vertical icon sidebar + collapsible case header. The existing Dashboard becomes a fallback for first-run onboarding only. The root layout changes from `TopBar + Outlet` to `Sidebar + (TopBar + Outlet)`.

**Tech Stack:** React 19, TanStack Router (hash history), React Query, Zustand, Tailwind v4, Motion (framer-motion), Lucide icons, Electron IPC (settings persistence).

---

## File Structure

### New files
- `src/renderer/components/layout/Sidebar.tsx` — Vertical icon rail (Captures, Selectors, Notes, Tags, Settings at bottom)
- `src/renderer/components/layout/CommandPalette.tsx` — Ctrl+K case switcher overlay
- `src/renderer/components/layout/CaseHeader.tsx` — Collapsible case metadata header (name, description, stats — replaces CaseOverview)
- `src/renderer/components/layout/OnboardingWizard.tsx` — First-run onboarding (2 steps: extension + create case)
- `src/renderer/hooks/useSessionRestore.ts` — Hook that reads settings on mount and redirects to last active case+section
- `src/renderer/hooks/useCommandPalette.ts` — Ctrl+K keyboard shortcut listener + open/close state
- `tests/renderer/hooks/useSessionRestore.test.ts` — Tests for session restore logic
- `tests/renderer/components/CommandPalette.test.ts` — Tests for command palette

### Modified files
- `src/shared/types.ts` — Add `lastActiveCaseId` and `lastActiveSection` to `BirdbrainSettings`
- `src/main/services/settings.ts` — Add defaults for new fields
- `src/renderer/routes/__root.tsx` — Replace root layout (sidebar + content), remove `caseIndexRoute` (overview tab), change default case child to `/captures`
- `src/renderer/components/layout/TopBar.tsx` — Slim down: remove dashboard/case branching, always show case-mode controls when in a case
- `src/renderer/components/cases/CaseWorkspace.tsx` — Remove tab bar, add CaseHeader, delegate nav to sidebar
- `src/renderer/stores/appStore.ts` — Add `commandPaletteOpen` state
- `src/renderer/main.tsx` — Add `useSessionRestore` hook

### Files to remove (or stop importing)
- `src/renderer/components/dashboard/Dashboard.tsx` — Replaced by session restore + onboarding
- `src/renderer/components/dashboard/HeroSection.tsx` — No longer needed
- `src/renderer/components/dashboard/QuickStartGuide.tsx` — No longer needed
- `src/renderer/components/dashboard/DashboardFooter.tsx` — No longer needed
- `src/renderer/components/dashboard/ExtensionBanner.tsx` — Folded into onboarding wizard
- `src/renderer/components/dashboard/RecentCases.tsx` — Replaced by command palette
- `src/renderer/components/cases/CaseOverview.tsx` — Merged into CaseHeader
- `src/renderer/components/cases/CaseSwitcher.tsx` — Replaced by command palette

---

## Task 1: Add Session State to Settings

**Files:**
- Modify: `src/shared/types.ts:53-65`
- Modify: `src/main/services/settings.ts:7-19`
- Test: `tests/main/services/settings.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

Add a test to the existing settings test file:

```typescript
it('includes lastActiveCaseId and lastActiveSection in defaults', () => {
  const defaults = getDefaultSettings()
  expect(defaults.lastActiveCaseId).toBeNull()
  expect(defaults.lastActiveSection).toBe('captures')
})

it('persists and retrieves session state fields', () => {
  updateSettings({ lastActiveCaseId: 'case-123', lastActiveSection: 'notes' })
  const settings = getSettings()
  expect(settings.lastActiveCaseId).toBe('case-123')
  expect(settings.lastActiveSection).toBe('notes')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/services/settings.test.ts`
Expected: FAIL — `lastActiveCaseId` and `lastActiveSection` not on type

- [ ] **Step 3: Add fields to BirdbrainSettings type**

In `src/shared/types.ts`, add two fields to the `BirdbrainSettings` interface:

```typescript
export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  captureHtml: boolean
  dedupeWindowSeconds: number
  ignoredUrlPatterns: string[]
  storagePath: string
  maxStorageMb: number | null
  theme: 'dark' | 'light'
  operatorName: string
  autoCaptureMode: AutoCaptureMode
  lastActiveCaseId: string | null
  lastActiveSection: 'captures' | 'selectors' | 'notes' | 'tags' | 'settings'
}
```

- [ ] **Step 4: Add defaults to settings service**

In `src/main/services/settings.ts`, add to `DEFAULT_SETTINGS`:

```typescript
const DEFAULT_SETTINGS: BirdbrainSettings = {
  openRouterApiKey: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  captureScreenshots: true,
  captureHtml: true,
  dedupeWindowSeconds: 60,
  ignoredUrlPatterns: [],
  storagePath: '',
  maxStorageMb: null,
  theme: 'light',
  operatorName: '',
  autoCaptureMode: 'notify',
  lastActiveCaseId: null,
  lastActiveSection: 'captures'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- tests/main/services/settings.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/services/settings.ts tests/main/services/settings.test.ts
git commit -m "feat: add session restore fields to BirdbrainSettings"
```

---

## Task 2: Session Restore Hook

**Files:**
- Create: `src/renderer/hooks/useSessionRestore.ts`
- Test: `tests/renderer/hooks/useSessionRestore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/hooks/useSessionRestore.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.birdbrain.settings
const mockSettingsGet = vi.fn()
const mockSettingsUpdate = vi.fn()

vi.stubGlobal('birdbrain', {
  settings: {
    get: mockSettingsGet,
    update: mockSettingsUpdate
  },
  cases: { list: vi.fn().mockResolvedValue([]) }
})

// We test the pure logic, not the React hook wrapper
import { resolveStartRoute } from '@renderer/hooks/useSessionRestore'

describe('resolveStartRoute', () => {
  it('returns onboarding route when no cases exist and no lastActiveCaseId', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: null,
      lastActiveSection: 'captures',
      cases: []
    })
    expect(result).toEqual({ to: '/' })
  })

  it('returns last active case + section when case exists', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'notes',
      cases: [{ id: 'case-1', name: 'Test' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/notes',
      params: { caseId: 'case-1' }
    })
  })

  it('falls back to captures when lastActiveSection is invalid', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'captures',
      cases: [{ id: 'case-1', name: 'Test' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-1' }
    })
  })

  it('falls back to first case when lastActiveCaseId no longer exists', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'deleted-case',
      lastActiveSection: 'captures',
      cases: [{ id: 'case-2', name: 'Other' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-2' }
    })
  })

  it('handles settings section by routing to /settings', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'settings',
      cases: [{ id: 'case-1', name: 'Test' }]
    })
    expect(result).toEqual({ to: '/settings' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/renderer/hooks/useSessionRestore.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the session restore hook**

Create `src/renderer/hooks/useSessionRestore.ts`:

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/queries'
import type { BirdbrainSettings } from '@shared/types'

type Section = BirdbrainSettings['lastActiveSection']

interface ResolveInput {
  lastActiveCaseId: string | null
  lastActiveSection: Section
  cases: Array<{ id: string }>
}

const SECTION_PATHS: Record<Exclude<Section, 'settings'>, string> = {
  captures: '/cases/$caseId/captures',
  selectors: '/cases/$caseId/selectors',
  notes: '/cases/$caseId/notes',
  tags: '/cases/$caseId/tags'
}

export function resolveStartRoute(input: ResolveInput) {
  const { lastActiveCaseId, lastActiveSection, cases } = input

  // No cases at all — show onboarding
  if (cases.length === 0) {
    return { to: '/' as const }
  }

  // Settings section — no case context needed
  if (lastActiveSection === 'settings') {
    return { to: '/settings' as const }
  }

  // Find the target case (last active, or fallback to first case)
  const targetCase = lastActiveCaseId
    ? cases.find((c) => c.id === lastActiveCaseId) ?? cases[0]
    : cases[0]

  const path = SECTION_PATHS[lastActiveSection] ?? SECTION_PATHS.captures

  return {
    to: path,
    params: { caseId: targetCase.id }
  }
}

export function useSessionRestore() {
  const navigate = useNavigate()
  const { data: cases, isLoading: casesLoading } = useQuery(casesQueryOptions)
  const [resolved, setResolved] = useState(false)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    if (casesLoading || resolved) return

    async function restore() {
      try {
        const settings = await window.birdbrain.settings.get()
        const route = resolveStartRoute({
          lastActiveCaseId: settings.lastActiveCaseId,
          lastActiveSection: settings.lastActiveSection,
          cases: cases ?? []
        })
        navigate(route as Parameters<typeof navigate>[0])
      } finally {
        setResolved(true)
        setRestoring(false)
      }
    }

    restore()
  }, [casesLoading, resolved, cases, navigate])

  return { restoring }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/renderer/hooks/useSessionRestore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useSessionRestore.ts tests/renderer/hooks/useSessionRestore.test.ts
git commit -m "feat: add useSessionRestore hook for workspace auto-restore"
```

---

## Task 3: Persist Active Case on Navigation

This task wires up the session persistence — every time the user navigates to a case section, we write `lastActiveCaseId` and `lastActiveSection` to settings.

**Files:**
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx:40-57`

- [ ] **Step 1: Add session persistence to CaseWorkspace**

In `CaseWorkspace.tsx`, modify the existing `useEffect` that activates the case on the capture server. Extend it to also persist the session state:

```typescript
// Activate case on the capture server + persist session state
useEffect(() => {
  if (caseId) {
    fetch(`${CAPTURE_SERVER_BASE_URL}/api/cases/${caseId}/activate`, { method: 'POST' }).catch(
      (err) => console.error('Failed to activate case on server:', err)
    )
    // Persist last active case for session restore
    window.birdbrain.settings.update({ lastActiveCaseId: caseId })
  }
}, [caseId])
```

- [ ] **Step 2: Persist active section on tab change**

Add a second `useEffect` in `CaseWorkspace` that watches the current route and updates `lastActiveSection`:

```typescript
// Persist active section for session restore
useEffect(() => {
  const section = isCaptures
    ? 'captures'
    : isSelectors
      ? 'selectors'
      : isNotes
        ? 'notes'
        : isTags
          ? 'tags'
          : 'captures'
  window.birdbrain.settings.update({ lastActiveSection: section as BirdbrainSettings['lastActiveSection'] })
}, [isCaptures, isSelectors, isNotes, isTags])
```

Add the import at the top of the file:
```typescript
import type { BirdbrainSettings } from '@shared/types'
```

- [ ] **Step 3: Manually verify session persistence**

Run: `pnpm dev`
Steps:
1. Open the app, navigate to a case, click the Notes tab
2. Close the app
3. Check `%APPDATA%/birdbrain/settings.json` — it should contain `lastActiveCaseId` and `lastActiveSection: "notes"`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "feat: persist active case and section to settings on navigation"
```

---

## Task 4: Wire Session Restore into App Startup

**Files:**
- Modify: `src/renderer/routes/__root.tsx:32-51`
- Modify: `src/renderer/main.tsx:10-17`

- [ ] **Step 1: Add useSessionRestore to the root layout**

In `src/renderer/routes/__root.tsx`, modify the `RootLayout` component to call `useSessionRestore()`. It should only redirect on the initial mount when the user is at the index route:

```typescript
import { useSessionRestore } from '@renderer/hooks/useSessionRestore'

// Root layout
const rootRoute = createRootRoute({
  component: function RootLayout() {
    const { restoring } = useSessionRestore()

    if (restoring) {
      return (
        <div className="flex h-screen items-center justify-center bg-canvas">
          <div className="text-text-muted text-sm">Loading workspace...</div>
        </div>
      )
    }

    return (
      <MotionProvider>
        <div className="flex h-screen flex-col bg-canvas text-text-secondary">
          <TopBar />
          <div className="flex flex-1 overflow-hidden">
            <main className="flex-1 overflow-auto bg-canvas">
              <Outlet />
            </main>
          </div>
        </div>
        <Suspense>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      </MotionProvider>
    )
  }
})
```

- [ ] **Step 2: Verify session restore works end-to-end**

Run: `pnpm dev`
Steps:
1. Open app → it should auto-navigate to last case+section (if settings have one)
2. Navigate to Notes tab, close app
3. Reopen → should land on Notes tab of the same case

- [ ] **Step 3: Commit**

```bash
git add src/renderer/routes/__root.tsx
git commit -m "feat: wire session restore into root layout on app startup"
```

---

## Task 5: Vertical Icon Sidebar

**Files:**
- Create: `src/renderer/components/layout/Sidebar.tsx`
- Modify: `src/renderer/routes/__root.tsx` — Add sidebar to root layout

- [ ] **Step 1: Create the Sidebar component**

Create `src/renderer/components/layout/Sidebar.tsx`:

```typescript
import { useParams, useNavigate, useMatchRoute } from '@tanstack/react-router'
import { Layers, Crosshair, StickyNote, Tag, Settings } from 'lucide-react'

type SidebarSection = 'captures' | 'selectors' | 'notes' | 'tags' | 'settings'

const NAV_ITEMS: { id: SidebarSection; icon: typeof Layers; label: string }[] = [
  { id: 'captures', icon: Layers, label: 'Captures' },
  { id: 'selectors', icon: Crosshair, label: 'Selectors' },
  { id: 'notes', icon: StickyNote, label: 'Notes' },
  { id: 'tags', icon: Tag, label: 'Tags' }
]

function sectionPath(section: SidebarSection): string {
  switch (section) {
    case 'captures':
      return '/cases/$caseId/captures'
    case 'selectors':
      return '/cases/$caseId/selectors'
    case 'notes':
      return '/cases/$caseId/notes'
    case 'tags':
      return '/cases/$caseId/tags'
    case 'settings':
      return '/settings'
  }
}

export function Sidebar() {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const params = useParams({ strict: false }) as { caseId?: string }
  const caseId = params.caseId ?? null

  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false
  const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false
  const isTags = matchRoute({ to: '/cases/$caseId/tags', fuzzy: true }) !== false
  const isSettings = matchRoute({ to: '/settings' }) !== false

  function isActive(section: SidebarSection): boolean {
    switch (section) {
      case 'captures':
        return isCaptures
      case 'selectors':
        return isSelectors
      case 'notes':
        return isNotes
      case 'tags':
        return isTags
      case 'settings':
        return isSettings
    }
  }

  function handleClick(section: SidebarSection) {
    if (section === 'settings') {
      navigate({ to: '/settings' })
      return
    }
    if (!caseId) return
    navigate({ to: sectionPath(section), params: { caseId } } as Parameters<typeof navigate>[0])
  }

  // Don't render sidebar when no case is active and not on settings
  if (!caseId && !isSettings) return null

  return (
    <nav className="flex h-full w-12 flex-col items-center border-r border-border bg-surface py-2">
      {/* Main nav items */}
      <div className="flex flex-1 flex-col items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActive(item.id)
          return (
            <button
              key={item.id}
              onClick={() => handleClick(item.id)}
              disabled={!caseId}
              title={item.label}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                active
                  ? 'bg-accent-subtle text-accent'
                  : caseId
                    ? 'text-text-muted hover:bg-elevated hover:text-text-secondary'
                    : 'text-text-faint cursor-not-allowed'
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
              {active && (
                <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent" />
              )}
              {/* Tooltip */}
              <div className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-elevated px-2 py-1 text-xs font-medium text-text-primary opacity-0 shadow-lg transition-opacity group-hover:opacity-100 border border-border">
                {item.label}
              </div>
            </button>
          )
        })}
      </div>

      {/* Settings at bottom */}
      <div className="flex flex-col items-center gap-1 border-t border-border pt-2">
        <button
          onClick={() => handleClick('settings')}
          title="Settings"
          className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            isSettings
              ? 'bg-accent-subtle text-accent'
              : 'text-text-muted hover:bg-elevated hover:text-text-secondary'
          }`}
        >
          <Settings className="h-[18px] w-[18px]" />
          {isSettings && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent" />
          )}
          <div className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-elevated px-2 py-1 text-xs font-medium text-text-primary opacity-0 shadow-lg transition-opacity group-hover:opacity-100 border border-border">
            Settings
          </div>
        </button>
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Integrate sidebar into root layout**

In `src/renderer/routes/__root.tsx`, modify the `RootLayout` to include the sidebar:

```typescript
import { Sidebar } from '@renderer/components/layout/Sidebar'

// In the JSX return:
return (
  <MotionProvider>
    <div className="flex h-screen flex-col bg-canvas text-text-secondary">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-canvas">
          <Outlet />
        </main>
      </div>
    </div>
    <Suspense>
      <ReactQueryDevtools buttonPosition="bottom-left" />
      <TanStackRouterDevtools position="bottom-right" />
    </Suspense>
  </MotionProvider>
)
```

- [ ] **Step 3: Verify sidebar renders**

Run: `pnpm dev`
Expected: Sidebar appears on the left with icon buttons. Active section highlighted with accent indicator. Settings gear pinned at bottom.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/Sidebar.tsx src/renderer/routes/__root.tsx
git commit -m "feat: add vertical icon sidebar for workspace navigation"
```

---

## Task 6: Remove Horizontal Tab Bar from CaseWorkspace

**Files:**
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx`
- Modify: `src/renderer/routes/__root.tsx` — Remove `caseIndexRoute` (overview tab), default case child becomes captures

- [ ] **Step 1: Remove the tab bar from CaseWorkspace**

Replace the entire `CaseWorkspace` component in `src/renderer/components/cases/CaseWorkspace.tsx` with a simplified version that just renders the case content without tabs:

```typescript
import { useEffect } from 'react'
import { useParams, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions, capturesQueryOptions } from '@renderer/lib/queries'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'
import type { BirdbrainSettings } from '@shared/types'

export function CaseWorkspace() {
  const { caseId } = useParams({ from: '/cases/$caseId' })
  const matchRoute = useMatchRoute()
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)

  useSelectorFilters(caseId)

  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false
  const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false
  const isTags = matchRoute({ to: '/cases/$caseId/tags', fuzzy: true }) !== false

  // Activate case on the capture server + persist session state
  useEffect(() => {
    if (caseId) {
      fetch(`${CAPTURE_SERVER_BASE_URL}/api/cases/${caseId}/activate`, { method: 'POST' }).catch(
        (err) => console.error('Failed to activate case on server:', err)
      )
      window.birdbrain.settings.update({ lastActiveCaseId: caseId })
    }
  }, [caseId])

  // Persist active section for session restore
  useEffect(() => {
    const section: BirdbrainSettings['lastActiveSection'] = isCaptures
      ? 'captures'
      : isSelectors
        ? 'selectors'
        : isNotes
          ? 'notes'
          : isTags
            ? 'tags'
            : 'captures'
    window.birdbrain.settings.update({ lastActiveSection: section })
  }, [isCaptures, isSelectors, isNotes, isTags])

  const activeCase = cases.find((c) => c.id === caseId)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">Loading case...</div>
    )
  }

  if (!activeCase) return null

  // Captures needs full-bleed (no padding), other sections get padding
  if (isCaptures) {
    return <Outlet />
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <Outlet />
    </div>
  )
}
```

- [ ] **Step 2: Remove overview route, default case to captures**

In `src/renderer/routes/__root.tsx`:

1. Remove the `CaseOverview` import
2. Remove the `caseIndexRoute` definition
3. Remove `caseIndexRoute` from `caseRoute.addChildren()`
4. Make `capturesRoute` the index route for case workspace by changing its path to `/`

Actually, since we want `/cases/$caseId` to redirect to `/cases/$caseId/captures`, the simplest approach is to add a redirect in the case route:

```typescript
// Remove this import:
// import { CaseOverview } from '@renderer/components/cases/CaseOverview'

// Remove this route:
// const caseIndexRoute = createRoute({
//   getParentRoute: () => caseRoute,
//   path: '/',
//   component: CaseOverview
// })

// Add a case index route that redirects to captures:
const caseIndexRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/cases/$caseId/captures',
      params: { caseId: params.caseId }
    })
  }
})
```

Add the `redirect` import:
```typescript
import { createRootRoute, createRoute, Outlet, redirect } from '@tanstack/react-router'
```

- [ ] **Step 3: Verify navigation works**

Run: `pnpm dev`
Expected:
- Navigating to `/cases/$caseId` redirects to `/cases/$caseId/captures`
- No horizontal tab bar visible
- Sidebar handles all section navigation
- Captures still renders full-bleed, other sections have padding

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/cases/CaseWorkspace.tsx src/renderer/routes/__root.tsx
git commit -m "feat: remove horizontal tab bar, redirect case index to captures"
```

---

## Task 7: Case Header (Replaces CaseOverview)

The case metadata (name, description, stats) that was in the Overview tab now lives in a collapsible header at the top of the workspace content area.

**Files:**
- Create: `src/renderer/components/layout/CaseHeader.tsx`
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx` — Add CaseHeader above Outlet

- [ ] **Step 1: Create the CaseHeader component**

Create `src/renderer/components/layout/CaseHeader.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  caseQueryOptions,
  capturesQueryOptions,
  tagCountForCaseQueryOptions,
  useCasesMutations
} from '@renderer/lib/queries'
import { ChevronDown, Camera, Globe, Tags, Pencil, FileOutput } from 'lucide-react'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { AnimatePresence, motion } from 'motion/react'

export function CaseHeader() {
  const { caseId } = useParams({ strict: false })
  const { data: caseData } = useQuery(caseQueryOptions(caseId!))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId!))
  const { data: tagCount = 0 } = useQuery(tagCountForCaseQueryOptions(caseId!))
  const { update } = useCasesMutations()

  const [expanded, setExpanded] = useState(false)
  const [showExport, setShowExport] = useState(false)

  // Editable name
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Editable description
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState('')
  const descInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (caseData) {
      setNameValue(caseData.name)
      setDescValue(caseData.description ?? '')
    }
  }, [caseData])

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  useEffect(() => {
    if (editingDesc && descInputRef.current) {
      descInputRef.current.focus()
    }
  }, [editingDesc])

  async function saveName() {
    if (!caseData) return
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === caseData.name) {
      setNameValue(caseData.name)
      setEditingName(false)
      return
    }
    await update.mutateAsync({ id: caseData.id, name: trimmed })
    setEditingName(false)
  }

  async function saveDesc() {
    if (!caseData) return
    const trimmed = descValue.trim()
    if (trimmed === (caseData.description ?? '')) {
      setEditingDesc(false)
      return
    }
    await update.mutateAsync({ id: caseData.id, description: trimmed })
    setEditingDesc(false)
  }

  // Count unique domains
  const domainCount = new Set(
    captures
      .map((c) => {
        try {
          return new URL(c.url).hostname
        } catch {
          return null
        }
      })
      .filter(Boolean)
  ).size

  if (!caseData) return null

  return (
    <>
      <div className="shrink-0 border-b border-border bg-surface">
        {/* Collapsed view — always visible */}
        <div className="flex items-center gap-3 px-5 py-2.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-elevated transition-colors"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`}
            />
          </button>

          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') {
                  setNameValue(caseData.name)
                  setEditingName(false)
                }
              }}
              className="flex-1 rounded border border-accent bg-elevated px-2 py-0.5 font-display text-sm font-bold text-text-primary focus:outline-none"
            />
          ) : (
            <h2
              className="group cursor-pointer font-display text-sm font-bold text-text-primary"
              onClick={() => setEditingName(true)}
              title="Click to edit"
            >
              {caseData.name}
              <Pencil className="ml-1.5 inline-block h-3 w-3 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </h2>
          )}

          <div className="flex-1" />

          {/* Inline stats */}
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Camera className="h-3.5 w-3.5" />
              {captures.length}
            </span>
            <span className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              {domainCount}
            </span>
            <span className="flex items-center gap-1">
              <Tags className="h-3.5 w-3.5" />
              {tagCount}
            </span>
          </div>

          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border-strong px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-elevated hover:text-text-secondary transition-colors"
          >
            <FileOutput className="h-3.5 w-3.5" />
            Export
          </button>
        </div>

        {/* Expanded view — description and details */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border px-5 py-3">
                {editingDesc ? (
                  <textarea
                    ref={descInputRef}
                    value={descValue}
                    onChange={(e) => setDescValue(e.target.value)}
                    onBlur={saveDesc}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setDescValue(caseData.description ?? '')
                        setEditingDesc(false)
                      }
                    }}
                    rows={2}
                    className="w-full resize-none rounded border border-accent bg-elevated px-2 py-1 text-sm text-text-secondary focus:outline-none"
                  />
                ) : (
                  <p
                    className="cursor-pointer text-sm text-text-muted hover:text-text-secondary"
                    onClick={() => setEditingDesc(true)}
                    title="Click to edit description"
                  >
                    {caseData.description || (
                      <span className="italic text-text-faint">Add a description...</span>
                    )}
                  </p>
                )}

                {captures.length > 0 && (
                  <p className="mt-2 font-mono text-xs text-text-faint">
                    {new Date(captures[captures.length - 1].timestamp).toLocaleDateString()} —{' '}
                    {new Date(captures[0].timestamp).toLocaleDateString()}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showExport && caseData && (
          <ExportDialog
            caseId={caseData.id}
            caseName={caseData.name}
            onClose={() => setShowExport(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
```

- [ ] **Step 2: Add CaseHeader to CaseWorkspace**

In `src/renderer/components/cases/CaseWorkspace.tsx`, wrap the `Outlet` with `CaseHeader`:

```typescript
import { CaseHeader } from '@renderer/components/layout/CaseHeader'

// In the return:
if (!activeCase) return null

return (
  <div className="flex h-full flex-col">
    <CaseHeader />
    {isCaptures ? (
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    ) : (
      <div className="flex-1 overflow-auto p-6">
        <Outlet />
      </div>
    )}
  </div>
)
```

- [ ] **Step 3: Verify CaseHeader renders**

Run: `pnpm dev`
Expected:
- Collapsible header shows case name + inline stats (captures, domains, tags)
- Chevron toggles description panel
- Name and description are click-to-edit
- Export button opens export dialog

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/CaseHeader.tsx src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "feat: add collapsible CaseHeader replacing CaseOverview tab"
```

---

## Task 8: Command Palette (Ctrl+K Case Switcher)

**Files:**
- Create: `src/renderer/components/layout/CommandPalette.tsx`
- Create: `src/renderer/hooks/useCommandPalette.ts`
- Modify: `src/renderer/stores/appStore.ts` — Add `commandPaletteOpen` state
- Modify: `src/renderer/routes/__root.tsx` — Render CommandPalette

- [ ] **Step 1: Add commandPaletteOpen to appStore**

In `src/renderer/stores/appStore.ts`, add the state field and setter:

Add to the `AppState` interface:
```typescript
commandPaletteOpen: boolean
setCommandPaletteOpen: (open: boolean) => void
```

Add to the store initial state:
```typescript
commandPaletteOpen: false,
```

Add the setter:
```typescript
setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
```

- [ ] **Step 2: Create useCommandPalette hook**

Create `src/renderer/hooks/useCommandPalette.ts`:

```typescript
import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'

export function useCommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(!open)
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, setOpen])

  return { open, setOpen }
}
```

- [ ] **Step 3: Create CommandPalette component**

Create `src/renderer/components/layout/CommandPalette.tsx`:

```typescript
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions, captureCountsQueryOptions, useCasesMutations } from '@renderer/lib/queries'
import { useAppStore } from '@renderer/stores/appStore'
import { Search, Plus, Clock } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { caseId?: string }
  const activeCaseId = params.caseId ?? null

  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: captureCounts = {} } = useQuery(captureCountsQueryOptions)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter cases by search query
  const filtered = query.trim()
    ? cases.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
      )
    : cases

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex === filtered.length) {
        // "Create new investigation" option
        navigate({ to: '/cases/new' })
        setOpen(false)
      } else if (filtered[selectedIndex]) {
        navigate({
          to: '/cases/$caseId/captures',
          params: { caseId: filtered[selectedIndex].id }
        })
        setOpen(false)
      }
    }
  }

  function selectCase(caseId: string) {
    navigate({ to: '/cases/$caseId/captures', params: { caseId } })
    setOpen(false)
  }

  function formatAge(dateStr: string): string {
    const ms = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(ms / 60000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`
    const weeks = Math.floor(days / 7)
    return `${weeks}w`
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setOpen(false)}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2"
          >
            <div className="rounded-xl border border-border-strong bg-card shadow-2xl overflow-hidden">
              {/* Search input */}
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Search className="h-4 w-4 text-text-muted shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setSelectedIndex(0)
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Switch investigation..."
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted focus:outline-none"
                />
                <kbd className="rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
                  ESC
                </kbd>
              </div>

              {/* Case list */}
              <div className="max-h-80 overflow-auto py-1">
                {filtered.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => selectCase(c.id)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      i === selectedIndex
                        ? 'bg-accent-subtle text-text-primary'
                        : 'text-text-secondary hover:bg-elevated'
                    }`}
                  >
                    {c.id === activeCaseId && (
                      <div className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-text-faint">
                      {captureCounts[c.id] ?? 0} captures
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-text-faint">
                      <Clock className="h-3 w-3" />
                      {formatAge(c.updatedAt)}
                    </span>
                  </button>
                ))}

                {/* Create new option */}
                <button
                  onClick={() => {
                    navigate({ to: '/cases/new' })
                    setOpen(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(filtered.length)}
                  className={`flex w-full items-center gap-3 border-t border-border px-4 py-2.5 text-left text-sm transition-colors ${
                    selectedIndex === filtered.length
                      ? 'bg-accent-subtle text-text-primary'
                      : 'text-text-muted hover:bg-elevated'
                  }`}
                >
                  <Plus className="h-4 w-4" />
                  <span>Create new investigation</span>
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 4: Wire CommandPalette and keyboard hook into root layout**

In `src/renderer/routes/__root.tsx`, add:

```typescript
import { CommandPalette } from '@renderer/components/layout/CommandPalette'
import { useCommandPalette } from '@renderer/hooks/useCommandPalette'

// Inside RootLayout component, before the return:
useCommandPalette()

// Add <CommandPalette /> inside the MotionProvider, after the main layout div:
<CommandPalette />
```

- [ ] **Step 5: Verify command palette works**

Run: `pnpm dev`
Expected:
- `Ctrl+K` opens the command palette overlay
- Typing filters case list
- Arrow keys navigate, Enter selects
- Clicking a case switches workspace
- "Create new investigation" option at bottom
- `Escape` closes

- [ ] **Step 6: Commit**

```bash
git add src/renderer/stores/appStore.ts src/renderer/hooks/useCommandPalette.ts src/renderer/components/layout/CommandPalette.tsx src/renderer/routes/__root.tsx
git commit -m "feat: add command palette (Ctrl+K) for workspace switching"
```

---

## Task 9: Slim Down TopBar

With sidebar handling section navigation and command palette handling case switching, the TopBar simplifies significantly.

**Files:**
- Modify: `src/renderer/components/layout/TopBar.tsx`

- [ ] **Step 1: Rewrite TopBar for workspace model**

Replace `src/renderer/components/layout/TopBar.tsx` with:

```typescript
import { Radar, Sun, Moon } from 'lucide-react'
import { useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { casesQueryOptions } from '@renderer/lib/queries'
import { useTheme } from '@renderer/hooks/useTheme'

export function TopBar() {
  const matchRoute = useMatchRoute()
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { theme, toggleTheme } = useTheme()

  const caseMatch = matchRoute({ to: '/cases/$caseId', fuzzy: true })
  const activeCaseId = caseMatch ? (caseMatch as { caseId: string }).caseId : null
  const activeCase = activeCaseId ? cases.find((c) => c.id === activeCaseId) : null

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 app-region-drag">
      {/* Logo */}
      <div className="flex items-center gap-2 app-region-no-drag">
        <div className="glow-indigo flex h-6 w-6 items-center justify-center rounded-md bg-accent">
          <Radar className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="font-display text-xs font-extrabold tracking-tight text-text-primary">
          Birdbrain
        </span>
      </div>

      {/* Case name (clickable to open command palette) */}
      {activeCase && (
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="app-region-no-drag flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors"
          title="Switch investigation (Ctrl+K)"
        >
          {activeCase.name}
          <span className="text-[10px] text-text-faint">▾</span>
        </button>
      )}

      <div className="flex-1" />

      {/* Right controls */}
      <div className="flex items-center gap-2 app-region-no-drag">
        {activeCaseId && <SearchBar />}

        {activeCaseId && <SessionControls />}

        {sessionActive && (
          <div className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-[10px] font-medium text-red-400">REC</span>
          </div>
        )}

        <ConnectionStatus />
        <CaptureHealth />

        <button
          onClick={toggleTheme}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-accent transition-all duration-300"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </header>
  )
}
```

Key changes:
- Height reduced from `h-14` (56px) to `h-12` (48px)
- Removed Settings button (now in sidebar)
- Removed Bell/notification button (placeholder that did nothing)
- Removed breadcrumb navigation (case name is now a command palette trigger)
- Removed dashboard vs case mode branching — TopBar is consistent
- Case name clicks open command palette instead of navigating
- Slightly smaller logo and text

- [ ] **Step 2: Verify TopBar works**

Run: `pnpm dev`
Expected:
- Slim TopBar with logo, case name (clickable to open palette), search, session controls, status indicators, theme toggle
- No settings gear in TopBar (it's in sidebar)
- Clicking case name opens command palette

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/TopBar.tsx
git commit -m "feat: slim down TopBar for workspace-centric layout"
```

---

## Task 10: Onboarding Wizard (First-Run Experience)

When no cases exist (`cases.length === 0`), the index route shows a simple two-step onboarding wizard instead of the old Dashboard.

**Files:**
- Create: `src/renderer/components/layout/OnboardingWizard.tsx`
- Modify: `src/renderer/routes/__root.tsx` — Index route renders OnboardingWizard when no cases

- [ ] **Step 1: Create the OnboardingWizard component**

Create `src/renderer/components/layout/OnboardingWizard.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppStore } from '@renderer/stores/appStore'
import { useCasesMutations } from '@renderer/lib/queries'
import { Radar, Puzzle, FolderPlus, ArrowRight, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

export function OnboardingWizard() {
  const navigate = useNavigate()
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const { create } = useCasesMutations()
  const [step, setStep] = useState(0)
  const [caseName, setCaseName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreateCase() {
    if (!caseName.trim() || creating) return
    setCreating(true)
    try {
      const newCase = await create.mutateAsync({
        name: caseName.trim()
      })
      navigate({ to: '/cases/$caseId/captures', params: { caseId: newCase.id } })
    } catch {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent shadow-lg shadow-accent/20">
            <Radar className="h-7 w-7 text-white" />
          </div>
        </div>

        {/* Progress dots */}
        <div className="mb-6 flex justify-center gap-2">
          <div className={`h-1.5 rounded-full transition-all ${step === 0 ? 'w-6 bg-accent' : 'w-1.5 bg-accent/30'}`} />
          <div className={`h-1.5 rounded-full transition-all ${step === 1 ? 'w-6 bg-accent' : 'w-1.5 bg-elevated'}`} />
        </div>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="step-0"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="neu-card rounded-2xl p-8"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
                  <Puzzle className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-text-primary">
                    Connect Extension
                  </h2>
                  <p className="text-sm text-text-muted">Step 1 of 2</p>
                </div>
              </div>

              <p className="mb-6 text-sm leading-relaxed text-text-secondary">
                Install the Birdbrain Chrome extension to capture web pages directly from your
                browser. The extension sends captures to this app for analysis.
              </p>

              <div className="mb-6 rounded-xl border border-border-strong bg-elevated p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-3 w-3 rounded-full ${
                      connectedToExtension ? 'bg-emerald-500' : 'bg-text-faint animate-pulse'
                    }`}
                  />
                  <span className="text-sm font-medium text-text-secondary">
                    {connectedToExtension ? 'Extension connected' : 'Waiting for extension...'}
                  </span>
                  {connectedToExtension && <Check className="h-4 w-4 text-emerald-500" />}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 hover:bg-accent-hover transition-colors"
                >
                  {connectedToExtension ? 'Continue' : 'Skip for now'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="neu-card rounded-2xl p-8"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-subtle">
                  <FolderPlus className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-text-primary">
                    Create Investigation
                  </h2>
                  <p className="text-sm text-text-muted">Step 2 of 2</p>
                </div>
              </div>

              <p className="mb-6 text-sm leading-relaxed text-text-secondary">
                Investigations are workspaces where you organize captured evidence, tag findings, and
                track selectors.
              </p>

              <div className="mb-6">
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Investigation Name
                </label>
                <input
                  type="text"
                  value={caseName}
                  onChange={(e) => setCaseName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateCase()
                  }}
                  placeholder="e.g. Phishing Campaign Analysis"
                  className="w-full rounded-xl border border-border-strong bg-elevated px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(0)}
                  className="text-sm text-text-muted hover:text-text-secondary transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCreateCase}
                  disabled={!caseName.trim() || creating}
                  className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? 'Creating...' : 'Create & Start'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-6 text-center text-[11px] text-text-faint">
          <kbd className="rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-muted">
            Ctrl
          </kbd>
          {' + '}
          <kbd className="rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-muted">
            K
          </kbd>
          <span className="ml-1.5">to search investigations</span>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire OnboardingWizard into index route**

In `src/renderer/routes/__root.tsx`, modify the index route to conditionally render:

```typescript
import { OnboardingWizard } from '@renderer/components/layout/OnboardingWizard'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/queries'

// Replace the Dashboard index route:
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function IndexPage() {
    const { data: cases = [], isLoading } = useQuery(casesQueryOptions)

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <span className="text-sm text-text-muted">Loading...</span>
        </div>
      )
    }

    // No cases → onboarding. Session restore will redirect to case if one exists.
    return <OnboardingWizard />
  }
})
```

Remove the Dashboard import from the top of the file.

- [ ] **Step 3: Verify onboarding flow**

Run: `pnpm dev`
To test: clear `lastActiveCaseId` from settings.json and ensure no cases exist.
Expected:
- Step 1: Extension connection status
- Step 2: Create investigation form
- Creating a case navigates directly to `/cases/$caseId/captures`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/OnboardingWizard.tsx src/renderer/routes/__root.tsx
git commit -m "feat: add onboarding wizard for first-run experience"
```

---

## Task 11: Clean Up Removed Components

**Files:**
- Modify: `src/renderer/routes/__root.tsx` — Remove unused imports
- Delete (or mark unused): Dashboard, HeroSection, QuickStartGuide, ExtensionBanner, DashboardFooter, RecentCases, CaseOverview, CaseSwitcher

- [ ] **Step 1: Remove unused imports from __root.tsx**

Remove these imports from `src/renderer/routes/__root.tsx`:
```typescript
// Remove:
// import { Dashboard } from '@renderer/components/dashboard/Dashboard'
// import { CaseOverview } from '@renderer/components/cases/CaseOverview'
```

- [ ] **Step 2: Delete dashboard components**

Delete the following files that are no longer imported anywhere:
- `src/renderer/components/dashboard/Dashboard.tsx`
- `src/renderer/components/dashboard/HeroSection.tsx`
- `src/renderer/components/dashboard/QuickStartGuide.tsx`
- `src/renderer/components/dashboard/DashboardFooter.tsx`
- `src/renderer/components/dashboard/ExtensionBanner.tsx`
- `src/renderer/components/dashboard/RecentCases.tsx`

Also delete:
- `src/renderer/components/cases/CaseOverview.tsx` (merged into CaseHeader)
- `src/renderer/components/cases/CaseSwitcher.tsx` (replaced by CommandPalette)

- [ ] **Step 3: Verify no broken imports**

Run: `pnpm build`
Expected: Build succeeds with no missing module errors.

- [ ] **Step 4: Run existing tests**

Run: `pnpm test`
Expected: All tests pass. If any test references deleted components, update or remove those tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated dashboard, CaseOverview, CaseSwitcher components"
```

---

## Task 12: Settings Route via Sidebar

Settings was previously a route navigated from TopBar. Now it's accessible via the sidebar gear icon. Ensure the settings route still works and the sidebar shows settings as active.

**Files:**
- Modify: `src/renderer/routes/__root.tsx` — Settings route stays as-is (no changes needed)

- [ ] **Step 1: Persist settings section on navigation**

The sidebar already navigates to `/settings`. We need to make sure the settings page persists `lastActiveSection: 'settings'` so session restore brings the user back to settings if that's where they were.

In `src/renderer/components/settings/SettingsView.tsx`, add an effect:

```typescript
import { useEffect } from 'react'

// Inside the component, at the top:
useEffect(() => {
  window.birdbrain.settings.update({ lastActiveSection: 'settings' })
}, [])
```

- [ ] **Step 2: Verify settings navigation**

Run: `pnpm dev`
Expected:
- Clicking gear icon in sidebar navigates to settings
- Sidebar highlights settings icon
- Session restore returns to settings if that was the last section

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsView.tsx
git commit -m "feat: persist settings as active section for session restore"
```

---

## Task 13: Update E2E Tests

**Files:**
- Modify: `e2e/app.spec.ts` (or relevant E2E test files)

- [ ] **Step 1: Check which E2E tests reference removed components**

Run: `grep -r "dashboard\|Welcome to Birdbrain\|HeroSection\|QuickStartGuide\|CaseOverview\|tab-badge" e2e/`

Update tests that:
- Look for Dashboard or "Welcome to Birdbrain" text
- Click on Overview tab
- Navigate via breadcrumbs
- Use the old CaseSwitcher

- [ ] **Step 2: Update E2E tests for new flow**

Key changes:
- App now starts at onboarding wizard (if no cases) or auto-restores (if cases exist)
- Navigation uses sidebar icons, not horizontal tabs
- Case switching uses Ctrl+K command palette
- No Overview tab — case starts on Captures

Update assertions to match new UI flow.

- [ ] **Step 3: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All E2E tests pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test: update E2E tests for workspace-centric navigation"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: No lint errors.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`
Test these flows:
1. **Fresh start (no cases):** App shows onboarding wizard → create case → lands in workspace
2. **Session restore:** Close app while on Notes tab → reopen → lands on Notes tab of same case
3. **Command palette:** `Ctrl+K` opens palette → type to filter → select case → workspace switches
4. **Sidebar navigation:** Click each icon → correct section loads
5. **Case header:** Expand/collapse → edit name/description → export button works
6. **Settings:** Sidebar gear → settings loads → session restore returns to settings
7. **New case:** `Ctrl+K` → "Create new investigation" → wizard → creates case → workspace opens

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: final workspace redesign polish"
```
