# Focused Single-Case Navigation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar-based navigation with a dashboard + tabbed single-case workspace, so only one case is visible at a time.

**Architecture:** Remove the sidebar entirely. The app switches between two modes — a dashboard showing all cases, and a case workspace with a horizontal tab bar (Overview, Captures, Entities, Analysis, Selectors). Settings becomes a full-screen overlay. The Zustand store gets a two-level state model (`appMode` + `activeCaseTab`) replacing the flat `activeView`.

**Tech Stack:** React 19, Zustand, Tailwind v4, Vitest, Playwright (E2E)

**Spec:** `docs/superpowers/specs/2026-03-16-focused-case-navigation-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/renderer/components/cases/CaseWorkspace.tsx` | Case workspace layout: header + tab bar + tab content router |
| `src/renderer/components/cases/CaseSwitcher.tsx` | Dropdown for switching between cases from the top bar |
| `src/renderer/components/cases/CaseEntities.tsx` | Case-wide entity aggregation table with filters |
| `tests/renderer/stores/appStore.test.ts` | Unit tests for the refactored Zustand store |
| `tests/renderer/components/CaseWorkspace.test.ts` | Unit tests for CaseWorkspace tab routing |

### Modified Files
| File | Changes |
|------|---------|
| `src/renderer/stores/appStore.ts` | New state shape (`appMode`, `activeCaseTab`, `settingsOpen`), new actions, remove `activeView`/`sidebarCollapsed` |
| `src/renderer/App.tsx` | Remove Sidebar import and rendering |
| `src/renderer/components/layout/MainContent.tsx` | Switch on `appMode` instead of `activeView`, render settings overlay |
| `src/renderer/components/layout/TopBar.tsx` | Conditional rendering: back button + case name + switcher in case mode |
| `src/renderer/components/cases/CaseOverview.tsx` | Adapt for Overview tab (remove selectors section, add editable description) |
| `src/renderer/components/captures/CaptureList.tsx` | Remove max-height constraint, work as left panel in master-detail |
| `src/renderer/components/captures/CaptureItem.tsx` | Minor styling adjustments for wider panel context (remove truncation constraints sized for sidebar) |
| `src/renderer/components/captures/CaptureViewer.tsx` | Work as right panel in master-detail, remove `activeView` dependency. Note: `selectCapture` no longer sets `activeView: 'capture-viewer'` — this is correct because capture selection now happens within the Captures tab panel, not as a full-page navigation. |
| `src/renderer/components/selectors/SelectorsOverview.tsx` | Scope to active case only, remove cross-case table |
| `e2e/cases.spec.ts` | Update selectors for new navigation (no sidebar) |

### Important: Export Convention

All existing components use **named exports** (`export function ComponentName`). New components MUST follow this convention. All imports must use named import syntax: `import { ComponentName } from '...'`.

### Removed Files
| File | Reason |
|------|--------|
| `src/renderer/components/layout/Sidebar.tsx` | Sidebar is eliminated |

---

## Task 1: Refactor Zustand Store

**Files:**
- Modify: `src/renderer/stores/appStore.ts`
- Create: `tests/renderer/stores/appStore.test.ts`

This is the foundation — all other tasks depend on this.

- [ ] **Step 1: Create the store test file with tests for the NEW state shape**

Create `tests/renderer/stores/appStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@renderer/stores/appStore'

describe('appStore', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useAppStore.setState({
      activeCaseId: null,
      appMode: 'dashboard',
      activeCaseTab: 'overview',
      settingsOpen: false,
      sessionActive: false,
      connectedToExtension: false,
      selectedCaptureId: null,
      searchQuery: ''
    })
  })

  describe('initial state', () => {
    it('starts in dashboard mode with overview tab', () => {
      const state = useAppStore.getState()
      expect(state.appMode).toBe('dashboard')
      expect(state.activeCaseTab).toBe('overview')
      expect(state.activeCaseId).toBeNull()
      expect(state.selectedCaptureId).toBeNull()
      expect(state.settingsOpen).toBe(false)
    })
  })

  describe('selectCase', () => {
    it('switches to case-workspace mode and sets case id', () => {
      useAppStore.getState().selectCase('case-1')
      const state = useAppStore.getState()
      expect(state.appMode).toBe('case-workspace')
      expect(state.activeCaseId).toBe('case-1')
      expect(state.selectedCaptureId).toBeNull()
    })

    it('preserves current activeCaseTab when switching cases', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().setActiveTab('captures')
      useAppStore.getState().selectCase('case-2')
      const state = useAppStore.getState()
      expect(state.activeCaseTab).toBe('captures')
      expect(state.activeCaseId).toBe('case-2')
    })

    it('clears selectedCaptureId when switching cases', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().selectCapture('cap-1')
      useAppStore.getState().selectCase('case-2')
      expect(useAppStore.getState().selectedCaptureId).toBeNull()
    })
  })

  describe('goToDashboard', () => {
    it('resets to dashboard mode and clears case/capture', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().selectCapture('cap-1')
      useAppStore.getState().goToDashboard()
      const state = useAppStore.getState()
      expect(state.appMode).toBe('dashboard')
      expect(state.activeCaseId).toBeNull()
      expect(state.selectedCaptureId).toBeNull()
    })
  })

  describe('setActiveTab', () => {
    it('changes the active case tab', () => {
      useAppStore.getState().setActiveTab('entities')
      expect(useAppStore.getState().activeCaseTab).toBe('entities')
    })
  })

  describe('selectCapture', () => {
    it('sets selectedCaptureId without changing mode or tab', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().setActiveTab('captures')
      useAppStore.getState().selectCapture('cap-1')
      const state = useAppStore.getState()
      expect(state.selectedCaptureId).toBe('cap-1')
      expect(state.appMode).toBe('case-workspace')
      expect(state.activeCaseTab).toBe('captures')
    })
  })

  describe('navigateToCapture', () => {
    it('switches to captures tab and sets capture id', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().setActiveTab('entities')
      useAppStore.getState().navigateToCapture('cap-1')
      const state = useAppStore.getState()
      expect(state.activeCaseTab).toBe('captures')
      expect(state.selectedCaptureId).toBe('cap-1')
    })
  })

  describe('toggleSettings', () => {
    it('toggles settingsOpen without changing appMode', () => {
      useAppStore.getState().selectCase('case-1')
      useAppStore.getState().toggleSettings()
      const state = useAppStore.getState()
      expect(state.settingsOpen).toBe(true)
      expect(state.appMode).toBe('case-workspace')
      expect(state.activeCaseId).toBe('case-1')
    })

    it('toggles back to closed', () => {
      useAppStore.getState().toggleSettings()
      useAppStore.getState().toggleSettings()
      expect(useAppStore.getState().settingsOpen).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/renderer/stores/appStore.test.ts`
Expected: FAIL — `appMode`, `activeCaseTab`, `settingsOpen`, `setActiveTab`, `navigateToCapture`, `toggleSettings` don't exist yet.

- [ ] **Step 3: Rewrite appStore.ts with the new state shape**

Replace the contents of `src/renderer/stores/appStore.ts` with:

```typescript
import { create } from 'zustand'

export type AppMode = 'dashboard' | 'case-workspace'
export type CaseTab = 'overview' | 'captures' | 'entities' | 'analysis' | 'selectors'

interface AppState {
  activeCaseId: string | null
  appMode: AppMode
  activeCaseTab: CaseTab
  settingsOpen: boolean
  sessionActive: boolean
  connectedToExtension: boolean
  selectedCaptureId: string | null
  searchQuery: string

  setActiveCaseId: (id: string | null) => void
  setSessionActive: (active: boolean) => void
  setConnectedToExtension: (connected: boolean) => void
  setSelectedCaptureId: (id: string | null) => void
  setSearchQuery: (query: string) => void
  selectCase: (id: string) => void
  selectCapture: (id: string) => void
  navigateToCapture: (id: string) => void
  setActiveTab: (tab: CaseTab) => void
  goToDashboard: () => void
  toggleSettings: () => void
}

export const useAppStore = create<AppState>((set) => ({
  activeCaseId: null,
  appMode: 'dashboard',
  activeCaseTab: 'overview',
  settingsOpen: false,
  sessionActive: false,
  connectedToExtension: false,
  selectedCaptureId: null,
  searchQuery: '',

  setActiveCaseId: (id) => set({ activeCaseId: id }),
  setSessionActive: (active) => set({ sessionActive: active }),
  setConnectedToExtension: (connected) => set({ connectedToExtension: connected }),
  setSelectedCaptureId: (id) => set({ selectedCaptureId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectCase: (id) =>
    set({ activeCaseId: id, appMode: 'case-workspace', selectedCaptureId: null }),

  selectCapture: (id) => set({ selectedCaptureId: id }),

  navigateToCapture: (id) =>
    set({ activeCaseTab: 'captures', selectedCaptureId: id }),

  setActiveTab: (tab) => set({ activeCaseTab: tab }),

  goToDashboard: () =>
    set({ activeCaseId: null, appMode: 'dashboard', selectedCaptureId: null }),

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen }))
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/renderer/stores/appStore.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/appStore.ts tests/renderer/stores/appStore.test.ts
git commit -m "refactor: replace flat activeView with appMode + activeCaseTab in store

New two-level navigation state: appMode (dashboard/case-workspace) and
activeCaseTab (overview/captures/entities/analysis/selectors). Settings
becomes a boolean overlay. Removes activeView and sidebarCollapsed."
```

---

## Task 2: Fix Compilation — Update All activeView / sidebarCollapsed References

**Files:**
- Modify: `src/renderer/components/layout/MainContent.tsx`
- Modify: `src/renderer/components/layout/TopBar.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/cases/CaseOverview.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx`

After Task 1, the app won't compile because many components reference the removed `activeView`, `sidebarCollapsed`, `setActiveView`, and `toggleSidebar`. This task does the minimum to make it compile again — replacing references with their new equivalents. The components will be fully refactored in later tasks.

- [ ] **Step 1: Update MainContent.tsx — temporary passthrough**

Replace `src/renderer/components/layout/MainContent.tsx` with a simplified version that routes on `appMode`. For now, map old views to maintain basic functionality while we build out the new components. Note: CaseAnalysis and SelectorsOverview become temporarily unreachable until Task 3 adds CaseWorkspace with tabs — this is acceptable as a transitional state.

```typescript
import { useAppStore } from '@renderer/stores/appStore'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CaseAnalysis } from '@renderer/components/analysis/CaseAnalysis'
import { SettingsView } from '@renderer/components/settings/SettingsView'

export function MainContent() {
  const appMode = useAppStore((s) => s.appMode)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const activeCaseTab = useAppStore((s) => s.activeCaseTab)

  if (settingsOpen) {
    return (
      <main className="flex-1 overflow-auto bg-neutral-950 p-6">
        <SettingsView />
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-auto bg-neutral-950 p-6">
      {appMode === 'dashboard' && <Dashboard />}
      {appMode === 'case-workspace' && activeCaseTab === 'overview' && <CaseOverview />}
      {appMode === 'case-workspace' && activeCaseTab === 'analysis' && <CaseAnalysis />}
    </main>
  )
}
```

- [ ] **Step 2: Update TopBar.tsx — remove sidebar toggle and activeView references**

In `src/renderer/components/layout/TopBar.tsx`:
- Remove the `toggleSidebar` call and sidebar toggle button
- Remove the `sidebarCollapsed` read
- Replace `setActiveView('settings')` with `toggleSettings()`
- Keep the rest (search, session controls, connection status) as-is

```typescript
import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'

export function TopBar() {
  const goToDashboard = useAppStore((s) => s.goToDashboard)
  const toggleSettings = useAppStore((s) => s.toggleSettings)

  return (
    <header className="flex h-12 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4">
      <button
        onClick={goToDashboard}
        className="text-sm font-bold tracking-wide text-neutral-100 hover:text-white"
      >
        Birdbrain
      </button>

      <SearchBar />

      <div className="flex items-center gap-2">
        <SessionControls />
        <ConnectionStatus />
        <button
          onClick={toggleSettings}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          title="Settings"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Update App.tsx — remove Sidebar**

Replace `src/renderer/App.tsx`:

```typescript
import { TopBar } from '@renderer/components/layout/TopBar'
import { MainContent } from '@renderer/components/layout/MainContent'
import { useServerStatus } from '@renderer/hooks/useServerStatus'

export function App() {
  useServerStatus()

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <MainContent />
      </div>
    </div>
  )
}
```

**Note:** Check `src/renderer/main.tsx` (or the renderer entry point) to see if App is imported as default or named — update the import to match.

- [ ] **Step 4: Update CaseOverview.tsx — replace setActiveView with setActiveTab**

In `src/renderer/components/cases/CaseOverview.tsx`, find and replace:
- `setActiveView` → `setActiveTab`
- `setActiveView('case-analysis')` → `setActiveTab('analysis')`
- Any other `activeView` references

- [ ] **Step 5: Update CaptureViewer.tsx — remove activeView dependency**

In `src/renderer/components/captures/CaptureViewer.tsx`:
- Remove any direct references to `activeView` if present
- **Behavioral change note:** The old `selectCapture` action set `activeView: 'capture-viewer'`, navigating the whole main content area. The new `selectCapture` only sets `selectedCaptureId` — this is correct because capture selection now happens within the Captures tab's right panel, not as a full-page navigation. The prev/next buttons in CaptureViewer call `selectCapture()` which will update `selectedCaptureId` and the right panel re-renders. No view/tab change is needed or desired.
- The component already reads `selectedCaptureId` and `activeCaseId` from the store, which are unchanged

- [ ] **Step 6: Verify the app compiles**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors.

Run: `pnpm test`
Expected: All existing tests pass + new store tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/layout/MainContent.tsx src/renderer/components/layout/TopBar.tsx src/renderer/App.tsx src/renderer/components/cases/CaseOverview.tsx src/renderer/components/captures/CaptureViewer.tsx
git commit -m "refactor: update all components to use new store shape

Replace activeView references with appMode/activeCaseTab. Remove
Sidebar from App.tsx. TopBar uses toggleSettings instead of
setActiveView. MainContent routes on appMode."
```

---

## Task 3: Create CaseWorkspace Component

**Files:**
- Create: `src/renderer/components/cases/CaseWorkspace.tsx`
- Modify: `src/renderer/components/layout/MainContent.tsx`

- [ ] **Step 1: Create CaseWorkspace.tsx with tab bar and content routing**

Create `src/renderer/components/cases/CaseWorkspace.tsx`:

```typescript
import { useAppStore } from '@renderer/stores/appStore'
import type { CaseTab } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaseAnalysis } from '@renderer/components/analysis/CaseAnalysis'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'

const tabs: { id: CaseTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'captures', label: 'Captures' },
  { id: 'entities', label: 'Entities' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'selectors', label: 'Selectors' }
]

export function CaseWorkspace() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const activeCaseTab = useAppStore((s) => s.activeCaseTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { cases } = useCases()

  const activeCase = cases.find((c) => c.id === activeCaseId)

  if (!activeCaseId || !activeCase) return null

  return (
    <div className="flex h-full flex-col">
      {/* Case header */}
      <div className="border-b border-neutral-800 px-6 pb-2 pt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-neutral-100">
            {activeCase.name}
          </h1>
          {sessionActive && (
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" title="Recording" />
          )}
        </div>
        {activeCase.description && (
          <p className="mt-1 text-sm text-neutral-400">{activeCase.description}</p>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-neutral-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeCaseTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {activeCaseTab === 'overview' && <CaseOverview />}
        {activeCaseTab === 'captures' && (
          <div className="flex h-full gap-4">
            <div className="w-[30%] overflow-y-auto">
              <CaptureList caseId={activeCaseId} />
            </div>
            <div className="flex-1 overflow-y-auto">
              <CaptureViewer />
            </div>
          </div>
        )}
        {activeCaseTab === 'entities' && (
          <div className="text-neutral-500">Entities view — coming in Task 7</div>
        )}
        {activeCaseTab === 'analysis' && <CaseAnalysis />}
        {activeCaseTab === 'selectors' && <SelectorsOverview />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update MainContent.tsx to render CaseWorkspace**

Replace `src/renderer/components/layout/MainContent.tsx`:

```typescript
import { useAppStore } from '@renderer/stores/appStore'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CaseWorkspace } from '@renderer/components/cases/CaseWorkspace'
import { SettingsView } from '@renderer/components/settings/SettingsView'

export function MainContent() {
  const appMode = useAppStore((s) => s.appMode)
  const settingsOpen = useAppStore((s) => s.settingsOpen)

  if (settingsOpen) {
    return (
      <main className="flex-1 overflow-auto bg-neutral-950">
        <SettingsView />
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-auto bg-neutral-950">
      {appMode === 'dashboard' && (
        <div className="p-6">
          <Dashboard />
        </div>
      )}
      {appMode === 'case-workspace' && <CaseWorkspace />}
    </main>
  )
}
```

- [ ] **Step 3: Verify the app builds and basic navigation works**

Run: `pnpm build`
Expected: Build succeeds.

Run: `pnpm dev` and manually test:
1. Dashboard loads on startup
2. Clicking a case shows the CaseWorkspace with tab bar
3. Tabs switch correctly
4. Settings gear opens settings overlay
5. Back to dashboard works (Birdbrain logo click)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/cases/CaseWorkspace.tsx src/renderer/components/layout/MainContent.tsx
git commit -m "feat: add CaseWorkspace with tab bar navigation

New tabbed case workspace replaces the old single-view layout.
Tabs: Overview, Captures (master-detail), Entities (placeholder),
Analysis, and Selectors. MainContent now routes on appMode."
```

---

## Task 4: Update TopBar with Case Navigation

**Files:**
- Modify: `src/renderer/components/layout/TopBar.tsx`
- Create: `src/renderer/components/cases/CaseSwitcher.tsx`

- [ ] **Step 1: Create CaseSwitcher.tsx**

Create `src/renderer/components/cases/CaseSwitcher.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'

export function CaseSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const selectCase = useAppStore((s) => s.selectCase)
  const { cases } = useCases()

  const activeCase = cases.find((c) => c.id === activeCaseId)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (!activeCase) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm font-semibold text-neutral-100 hover:text-white"
      >
        {activeCase.name}
        <span className="text-xs text-neutral-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl">
          {cases.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                selectCase(c.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-700 ${
                c.id === activeCaseId ? 'bg-neutral-700/50 text-white' : 'text-neutral-300'
              }`}
            >
              {sessionActive && c.id === activeCaseId && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              )}
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update TopBar.tsx with conditional case navigation**

Replace `src/renderer/components/layout/TopBar.tsx`:

```typescript
import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaseSwitcher } from '@renderer/components/cases/CaseSwitcher'

export function TopBar() {
  const appMode = useAppStore((s) => s.appMode)
  const goToDashboard = useAppStore((s) => s.goToDashboard)
  const toggleSettings = useAppStore((s) => s.toggleSettings)

  return (
    <header className="flex h-12 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4">
      {appMode === 'case-workspace' ? (
        <div className="flex items-center gap-2">
          <button
            onClick={goToDashboard}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            title="Back to dashboard"
          >
            ←
          </button>
          <CaseSwitcher />
        </div>
      ) : (
        <button
          onClick={goToDashboard}
          className="text-sm font-bold tracking-wide text-neutral-100 hover:text-white"
        >
          Birdbrain
        </button>
      )}

      <SearchBar />

      <div className="flex items-center gap-2">
        <SessionControls />
        <ConnectionStatus />
        <button
          onClick={toggleSettings}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          title="Settings"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Verify the top bar works**

Run: `pnpm build`
Expected: Build succeeds.

Run: `pnpm dev` and test:
1. Dashboard shows "Birdbrain" logo in top bar
2. Case workspace shows back arrow + case name with dropdown
3. Dropdown lists all cases with recording indicator
4. Switching cases via dropdown works
5. Back arrow returns to dashboard

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/cases/CaseSwitcher.tsx src/renderer/components/layout/TopBar.tsx
git commit -m "feat: add case switcher dropdown and contextual top bar

TopBar now shows back button + case name + dropdown chevron when in
case workspace mode. CaseSwitcher dropdown lists all cases with
recording indicator for the active session."
```

---

## Task 5: Adapt CaptureList and CaptureItem for Master-Detail Layout

**Files:**
- Modify: `src/renderer/components/captures/CaptureList.tsx`
- Modify: `src/renderer/components/captures/CaptureItem.tsx`

- [ ] **Step 1: Update CaptureList to work as a panel**

The current CaptureList has `max-h-64 overflow-y-auto` for sidebar use. It needs to fill the left panel of the master-detail split instead. Update `src/renderer/components/captures/CaptureList.tsx`:

- Remove `max-h-64` constraint — the parent container in CaseWorkspace controls height
- Keep the same data fetching and CaptureItem rendering
- The component already receives `caseId` as a prop and uses `useCaptures(caseId)`, which is correct

Key changes:
- Remove max-height styling
- Add `h-full` to the root element so it fills the panel
- Keep the header with capture count
- Keep CaptureItem click → `selectCapture(id)`

- [ ] **Step 2: Update CaptureItem styling for wider panel context**

In `src/renderer/components/captures/CaptureItem.tsx`, review any width constraints or truncation that was sized for the 288px (w-72) sidebar. The panel is now ~30% of the main area, which is wider. Adjust any `truncate` max-widths or padding if needed to make items look good in the wider panel.

- [ ] **Step 3: Verify captures tab works in master-detail**

Run: `pnpm dev` and test:
1. Click a case → click Captures tab
2. Left panel shows capture list filling the space
3. Click a capture → right panel shows CaptureViewer
4. Previous/next navigation in CaptureViewer works

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/captures/CaptureList.tsx src/renderer/components/captures/CaptureItem.tsx
git commit -m "refactor: adapt CaptureList and CaptureItem for master-detail layout

Remove sidebar max-height constraint so CaptureList fills the left
panel. Adjust CaptureItem styling for wider panel context."
```

---

## Task 6: Adapt CaseOverview for Overview Tab

**Files:**
- Modify: `src/renderer/components/cases/CaseOverview.tsx`

- [ ] **Step 1: Update CaseOverview for tab context**

In `src/renderer/components/cases/CaseOverview.tsx`:

1. Remove the `SelectorList` section — selectors now have their own tab
2. Remove the "Analyze Case" button that called `setActiveView('case-analysis')` — replace with `setActiveTab('analysis')`
3. Add editable case name and description fields (the header in CaseWorkspace shows read-only, the Overview tab is where you edit)
4. Keep: stats grid, top domains, capture timeline

Key changes:
- Import `setActiveTab` instead of `setActiveView`
- Remove SelectorList import and rendering
- Replace analyze button action: `setActiveTab('analysis')`
- Add inline editing for case name and description using `useCases().updateCase()`

- [ ] **Step 2: Verify Overview tab works**

Run: `pnpm dev` and test:
1. Select a case → Overview tab shows stats, domains, timeline
2. No selectors section visible
3. "Analyze" button switches to Analysis tab
4. Case name/description can be edited

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/cases/CaseOverview.tsx
git commit -m "refactor: adapt CaseOverview for Overview tab context

Remove selectors section (moved to Selectors tab). Replace
setActiveView with setActiveTab. Add inline editing for case
name and description."
```

---

## Task 7: Create CaseEntities Component

**Files:**
- Create: `src/renderer/components/cases/CaseEntities.tsx`
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx`

- [ ] **Step 1: Create CaseEntities.tsx**

Create `src/renderer/components/cases/CaseEntities.tsx`. This component aggregates entities across all captures in the case.

```typescript
import { Fragment, useState, useEffect, useRef } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import type { Entity } from '@shared/types'

export function CaseEntities() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const navigateToCapture = useAppStore((s) => s.navigateToCapture)
  const { captures } = useCaptures(activeCaseId)
  const [entities, setEntities] = useState<(Entity & { captureTitle: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [minConfidence, setMinConfidence] = useState(0)
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)

  // Track capture IDs to avoid infinite re-renders from array reference changes
  const captureIds = captures.map((c) => c.id).join(',')
  const capturesRef = useRef(captures)
  capturesRef.current = captures

  useEffect(() => {
    if (!activeCaseId || !captureIds) return
    setLoading(true)

    // Load entities for all captures in the case
    Promise.all(
      capturesRef.current.map(async (cap) => {
        const capEntities: Entity[] = await window.birdbrain.ai.getEntities(cap.id)
        return capEntities.map((e) => ({ ...e, captureTitle: cap.title || cap.url }))
      })
    ).then((results) => {
      setEntities(results.flat())
      setLoading(false)
    })
  }, [activeCaseId, captureIds])

  // Deduplicate by value+type, aggregate capture count
  const aggregated = entities.reduce<
    Map<string, { entity: Entity; captureIds: { id: string; title: string }[] }>
  >((acc, e) => {
    const key = `${e.type}:${e.value}`
    const existing = acc.get(key)
    if (existing) {
      if (!existing.captureIds.find((c) => c.id === e.captureId)) {
        existing.captureIds.push({ id: e.captureId, title: e.captureTitle })
      }
      // Keep highest confidence
      if ((e.confidence ?? 0) > (existing.entity.confidence ?? 0)) {
        existing.entity = e
      }
    } else {
      acc.set(key, {
        entity: e,
        captureIds: [{ id: e.captureId, title: e.captureTitle }]
      })
    }
    return acc
  }, new Map())

  const sources = new Set(entities.map((e) => e.source).filter(Boolean))
  const types = [...new Set(entities.map((e) => e.type))]

  const filtered = [...aggregated.values()].filter((item) => {
    if (typeFilter !== 'all' && item.entity.type !== typeFilter) return false
    if (sourceFilter !== 'all' && item.entity.source !== sourceFilter) return false
    if (minConfidence > 0 && (item.entity.confidence ?? 0) < minConfidence) return false
    return true
  })

  if (loading) {
    return <div className="text-neutral-500">Loading entities…</div>
  }

  if (entities.length === 0) {
    return (
      <div className="text-center text-neutral-500">
        <p>No entities found for this case.</p>
        <p className="mt-1 text-sm">Extract entities from captures to see them here.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {sources.size > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
          >
            <option value="all">All sources</option>
            <option value="rule">Rule</option>
            <option value="ai">AI</option>
          </select>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-400">Min confidence:</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-xs text-neutral-400">{Math.round(minConfidence * 100)}%</span>
        </div>
      </div>

      {/* Entity table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-neutral-500">
            <th className="pb-2 pr-4">Value</th>
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2 pr-4">Source</th>
            <th className="pb-2 pr-4">Confidence</th>
            <th className="pb-2">Captures</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(({ entity, captureIds }) => (
            <Fragment key={`${entity.type}:${entity.value}`}>
              <tr
                onClick={() => setExpandedEntity(
                  expandedEntity === `${entity.type}:${entity.value}` ? null : `${entity.type}:${entity.value}`
                )}
                className="cursor-pointer border-b border-neutral-800/50 hover:bg-neutral-800/30"
              >
                <td className="py-2 pr-4 text-neutral-100">{entity.value}</td>
                <td className="py-2 pr-4">
                  <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-xs">{entity.type}</span>
                </td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${
                    entity.source === 'rule' ? 'bg-emerald-900 text-emerald-300' : 'bg-blue-900 text-blue-300'
                  }`}>
                    {entity.source ?? 'AI'}
                  </span>
                </td>
                <td className="py-2 pr-4 text-neutral-400">
                  {entity.confidence != null ? `${Math.round(entity.confidence * 100)}%` : '—'}
                </td>
                <td className="py-2 text-neutral-400">{captureIds.length}</td>
              </tr>
              {expandedEntity === `${entity.type}:${entity.value}` && (
                <tr key={`${entity.id}-expanded`}>
                  <td colSpan={5} className="pb-3 pl-4 pt-1">
                    <div className="flex flex-wrap gap-2">
                      {captureIds.map((c) => (
                        <button
                          key={c.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            navigateToCapture(c.id)
                          }}
                          className="rounded bg-neutral-800 px-2 py-1 text-xs text-blue-400 hover:bg-neutral-700"
                        >
                          {c.title}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Wire CaseEntities into CaseWorkspace**

In `src/renderer/components/cases/CaseWorkspace.tsx`, replace the entities placeholder:

```typescript
// Add import at top
import { CaseEntities } from '@renderer/components/cases/CaseEntities'

// Replace the placeholder in the tab content section:
{activeCaseTab === 'entities' && <CaseEntities />}
```

- [ ] **Step 3: Verify Entities tab works**

Run: `pnpm dev` and test:
1. Select a case with captures that have entities
2. Click Entities tab → see aggregated entity table
3. Filter by type works
4. Click an entity row → expand shows capture links
5. Click a capture link → navigates to Captures tab with that capture selected

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/cases/CaseEntities.tsx src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "feat: add CaseEntities view for case-wide entity aggregation

New Entities tab shows all entities across all captures in a case,
deduplicated and aggregated by value+type. Supports type and source
filters. Clicking a capture link navigates to the Captures tab."
```

---

## Task 8: Scope SelectorsOverview to Active Case

**Files:**
- Modify: `src/renderer/components/selectors/SelectorsOverview.tsx`

- [ ] **Step 1: Update SelectorsOverview to be case-scoped**

In `src/renderer/components/selectors/SelectorsOverview.tsx`:

1. Import `useAppStore` and read `activeCaseId`
2. Remove the cross-case loading logic (loading all cases, loading selectors per case)
3. Load selectors only for `activeCaseId`
4. Remove the case filter dropdown (no longer needed — always one case)
5. Remove the "Case" column from the table

Key structural change: instead of loading selectors for every case and joining with case names, just call `window.birdbrain.selectors.list(activeCaseId)` directly.

- [ ] **Step 2: Verify Selectors tab works**

Run: `pnpm dev` and test:
1. Select a case → Selectors tab shows only that case's selectors
2. Enable/disable toggle works
3. Delete works
4. Switch to another case via dropdown → selectors update

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/selectors/SelectorsOverview.tsx
git commit -m "refactor: scope SelectorsOverview to active case only

Remove cross-case selector loading and case filter dropdown.
Selectors tab now shows only the active case's selectors."
```

---

## Task 9: Delete Sidebar and Clean Up

**Files:**
- Delete: `src/renderer/components/layout/Sidebar.tsx`
- Verify: No remaining imports of Sidebar

- [ ] **Step 1: Search for Sidebar references**

Run: `grep -r "Sidebar" src/renderer/ --include="*.tsx" --include="*.ts"`

Expect only the Sidebar.tsx file itself and possibly the import in App.tsx (already removed in Task 2).

- [ ] **Step 2: Delete Sidebar.tsx**

Delete `src/renderer/components/layout/Sidebar.tsx`.

- [ ] **Step 3: Verify build succeeds**

Run: `pnpm build`
Expected: Build succeeds with no references to deleted file.

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git rm src/renderer/components/layout/Sidebar.tsx
git commit -m "chore: remove Sidebar component

Sidebar responsibilities have been redistributed to Dashboard (case
list), CaseWorkspace tabs (captures, selectors), and TopBar (case
switcher)."
```

---

## Task 10: Update E2E Tests

**Files:**
- Modify: `e2e/cases.spec.ts`

The existing E2E tests reference sidebar-specific selectors (`data-testid="case-item"`, sidebar context menus). These need to be updated for the new navigation.

- [ ] **Step 1: Update cases.spec.ts for new navigation**

Key changes:
- Case creation still uses `[data-testid="new-case-btn"]` on the dashboard
- After creation, the app now navigates to the case workspace (not sidebar)
- "case appears in sidebar list" test needs to become "case appears on dashboard"
- Context menu tests (rename, delete) need to be updated for wherever those actions now live (dashboard case cards or case workspace header)
- Remove `page.reload()` + sidebar checks

Update the test to match the new navigation flow:
- Create case → verify case workspace loads with case name
- Go back to dashboard → verify case card appears
- Case rename/delete — if these actions are still accessible, update selectors; if not, note as a follow-up to add these actions to the new UI

- [ ] **Step 2: Run E2E tests**

Run: `pnpm test:e2e`
Expected: Tests pass with updated selectors.

Note: E2E tests require a built app (`pnpm build` first). If tests reference selectors that don't exist in the new UI yet (rename/delete context menus), mark those tests as `test.skip` with a TODO comment and create a follow-up task.

- [ ] **Step 3: Commit**

```bash
git add e2e/cases.spec.ts
git commit -m "test: update E2E tests for new navigation flow

Update case CRUD tests to work with dashboard + case workspace
navigation instead of sidebar-based navigation."
```

---

## Task 11: Final Integration Testing and Polish

**Files:**
- Various minor fixes as discovered

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: All unit tests pass.

Run: `pnpm build`
Expected: Clean build with no errors or warnings.

- [ ] **Step 2: Manual integration test checklist**

Test each flow in `pnpm dev`:

- [ ] App starts on dashboard
- [ ] Dashboard shows all cases as cards
- [ ] Click case card → case workspace with tab bar
- [ ] Overview tab: stats, timeline, editable name/description
- [ ] Captures tab: master-detail split, capture list on left, viewer on right
- [ ] Captures tab: click capture → detail loads in right panel
- [ ] Captures tab: prev/next navigation works
- [ ] Entities tab: aggregated entity table with filters
- [ ] Entities tab: click capture link → navigates to Captures tab
- [ ] Analysis tab: entity graph, timeline, insights
- [ ] Selectors tab: case-scoped selector management
- [ ] Top bar: back arrow returns to dashboard
- [ ] Top bar: case switcher dropdown lists all cases
- [ ] Top bar: switch case via dropdown preserves tab
- [ ] Settings: gear icon opens settings overlay
- [ ] Settings: closing returns to previous state
- [ ] Recording indicator: shows in case header and switcher dropdown
- [ ] Search: still works from top bar

- [ ] **Step 3: Fix any issues discovered**

Address any bugs or styling issues found during manual testing.

- [ ] **Step 4: Final commit**

Stage only the specific files that were changed during polish. Do NOT use `git add -A` as the repo has unrelated unstaged changes.

```bash
git add <list specific fixed files>
git commit -m "fix: polish navigation redesign after integration testing"
```

Only create this commit if there are actual fixes. Skip if everything passes cleanly.
