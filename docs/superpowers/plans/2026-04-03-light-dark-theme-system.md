# Light/Dark Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full light/dark theme system to Birdbrain with semantic CSS tokens, smooth toggle, and light mode as the new default.

**Architecture:** Semantic CSS custom properties defined in Tailwind v4's `@theme` directive in `globals.css`. Light values are `:root` defaults, dark overrides via `html.dark` class. All ~35 components migrated from hardcoded dark colors to semantic Tailwind classes (`bg-surface`, `text-primary`, etc.). Theme state managed by a `useTheme` hook with localStorage + IPC persistence.

**Tech Stack:** Tailwind CSS v4, React 19, Zustand, Electron IPC, CSS custom properties

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/renderer/styles/globals.css` | Modify | Token system, dark overrides, custom class theming |
| `src/renderer/index.html` | Modify | Flash prevention script |
| `src/renderer/hooks/useTheme.ts` | Create | Theme state hook (toggle, persist, transition) |
| `src/renderer/components/layout/TopBar.tsx` | Modify | Theme toggle button, color migration |
| `src/renderer/components/settings/AppearanceConfig.tsx` | Modify | Functional theme selector |
| `src/renderer/components/dashboard/Dashboard.tsx` | Modify | Color migration |
| `src/renderer/components/dashboard/HeroSection.tsx` | Modify | Color migration |
| `src/renderer/components/dashboard/CaseCard.tsx` | Modify | Color migration |
| `src/renderer/components/dashboard/RecentCases.tsx` | Modify | Color migration |
| `src/renderer/components/dashboard/QuickStartGuide.tsx` | Modify | Color migration |
| `src/renderer/components/dashboard/ExtensionBanner.tsx` | Modify | Color migration |
| `src/renderer/components/dashboard/DashboardFooter.tsx` | Modify | Color migration |
| `src/renderer/components/captures/CaptureList.tsx` | Modify | Color migration |
| `src/renderer/components/captures/CaptureItem.tsx` | Modify | Color migration |
| `src/renderer/components/captures/CaptureViewer.tsx` | Modify | Color migration |
| `src/renderer/components/cases/CaseWorkspace.tsx` | Modify | Color migration |
| `src/renderer/components/cases/CaseOverview.tsx` | Modify | Color migration |
| `src/renderer/components/cases/CaseSwitcher.tsx` | Modify | Color migration |
| `src/renderer/components/cases/CreateCaseDialog.tsx` | Modify | Color migration |
| `src/renderer/components/cases/NewCaseWizard.tsx` | Modify | Color migration |
| `src/renderer/components/selectors/SelectorTable.tsx` | Modify | Color migration |
| `src/renderer/components/selectors/SelectorTableRow.tsx` | Modify | Color migration |
| `src/renderer/components/selectors/SelectorsOverview.tsx` | Modify | Color migration |
| `src/renderer/components/selectors/CreateSelectorCard.tsx` | Modify | Color migration |
| `src/renderer/components/selectors/SelectorFilterFooter.tsx` | Modify | Color migration |
| `src/renderer/components/search/SearchBar.tsx` | Modify | Color migration |
| `src/renderer/components/tags/TagBadge.tsx` | No change | Uses inline styles with entity colors |
| `src/renderer/components/tags/TagManager.tsx` | Modify | Color migration |
| `src/renderer/components/status/SessionControls.tsx` | Modify | Color migration |
| `src/renderer/components/status/ConnectionStatus.tsx` | Modify | Color migration |
| `src/renderer/components/status/CaptureHealth.tsx` | Modify | Color migration |
| `src/renderer/components/export/ExportDialog.tsx` | Modify | Color migration |
| `src/renderer/components/settings/SettingsView.tsx` | Modify | Color migration |
| `src/renderer/components/settings/StorageConfig.tsx` | Modify | Color migration |
| `src/renderer/components/settings/AIConfig.tsx` | Modify | Color migration |
| `src/renderer/components/settings/CapturePreferences.tsx` | Modify | Color migration |
| `src/renderer/components/settings/About.tsx` | Modify | Color migration |
| `src/main/services/settings.ts` | Modify | Default theme to 'light' |
| `e2e/app-lifecycle.spec.ts` | Modify | Theme toggle E2E test |

---

### Task 1: CSS Token Foundation — globals.css

**Files:**
- Modify: `src/renderer/styles/globals.css`

This is the foundation everything else builds on. Replace the existing `@theme` block and custom classes with the semantic token system.

- [ ] **Step 1: Replace the `@theme` block with semantic tokens + existing raw palette**

Replace the entire contents of `src/renderer/styles/globals.css` with:

```css
@import "tailwindcss";
@import "@fontsource-variable/plus-jakarta-sans";
@import "@fontsource-variable/dm-sans";
@import "@fontsource-variable/jetbrains-mono";

@theme {
  /* Semantic surface tokens — light mode defaults */
  --color-canvas: #f4f5f7;
  --color-surface: #f8fafb;
  --color-card: #ffffff;
  --color-elevated: #ffffff;

  /* Semantic text tokens */
  --color-text-primary: #1e293b;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;
  --color-text-faint: #94a3b8;

  /* Accent tokens */
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-accent-subtle: #eef2ff;

  /* Border tokens */
  --color-border: rgba(0,0,0,0.04);
  --color-border-strong: rgba(0,0,0,0.08);

  /* Raw palette — entity types, status indicators, one-offs */
  --color-indigo-300: #a5b4fc;
  --color-indigo-400: #818cf8;
  --color-indigo-500: #6366f1;
  --color-indigo-600: #4f46e5;
  --color-indigo-700: #4338ca;

  --color-amber-400: #fbbf24;
  --color-amber-500: #f59e0b;
  --color-amber-600: #d97706;

  --color-emerald-400: #34d399;
  --color-emerald-500: #10b981;
  --color-emerald-700: #047857;

  --color-red-400: #f87171;
  --color-red-500: #ef4444;
  --color-red-600: #dc2626;

  --color-teal-500: #14b8a6;

  --color-slate-100: #f1f5f9;
  --color-slate-200: #e2e8f0;
  --color-slate-300: #cbd5e1;
  --color-slate-400: #94a3b8;
  --color-slate-500: #64748b;
  --color-slate-600: #475569;
  --color-slate-700: #334155;
  --color-slate-800: #1e293b;
  --color-slate-900: #0f172a;

  /* Fonts */
  --font-display: "Plus Jakarta Sans Variable", sans-serif;
  --font-body: "DM Sans Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
}

/* === Dark mode overrides === */
html.dark {
  --color-canvas: #000000;
  --color-surface: #0f172a;
  --color-card: #1e293b;
  --color-elevated: #273548;
  --color-text-primary: #f1f5f9;
  --color-text-secondary: #cbd5e1;
  --color-text-muted: #94a3b8;
  --color-text-faint: #475569;
  --color-accent: #818cf8;
  --color-accent-hover: #6366f1;
  --color-accent-subtle: rgba(79,70,229,0.15);
  --color-border: rgba(255,255,255,0.06);
  --color-border-strong: rgba(255,255,255,0.12);
}

/* === Shadow tokens (not in @theme — Tailwind doesn't generate shadow utilities from it) === */
:root {
  --shadow-card: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02);
  --shadow-card-hover: 0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04);
  --shadow-glow: 0 4px 12px rgba(79,70,229,0.25);
  --shadow-btn: 0 4px 12px rgba(79,70,229,0.25);
}
html.dark {
  --shadow-card: 0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3);
  --shadow-card-hover: 0 2px 12px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.4);
  --shadow-glow: 0 0 20px rgba(99,102,241,0.25), 0 0 60px rgba(99,102,241,0.08);
  --shadow-btn: 0 4px 20px rgba(99,102,241,0.4), 0 0 40px rgba(99,102,241,0.12);
}

/* === Smooth theme transition === */
html.transitioning,
html.transitioning * {
  transition: background-color 0.4s ease, color 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease !important;
}

/* === Base styles === */
body {
  @apply bg-canvas text-text-secondary;
  font-family: var(--font-body);
}

/* === Scrollbar === */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
html.dark ::-webkit-scrollbar-thumb { background: #334155; }
html.dark ::-webkit-scrollbar-thumb:hover { background: #475569; }

/* === Animations === */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.anim-in { animation: fadeIn 0.4s ease-out forwards; opacity: 0; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-6px); }
}
@keyframes shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}
@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 0.4; }
  100% { transform: scale(1.8); opacity: 0; }
}
@keyframes glow-pulse {
  0%, 100% { box-shadow: var(--shadow-glow); }
  50% { box-shadow: var(--shadow-glow), 0 0 30px rgba(99,102,241,0.15); }
}
@keyframes expandIn {
  from { opacity: 0; max-height: 0; }
  to { opacity: 1; max-height: 200px; }
}
@keyframes softPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.15); }
  50% { box-shadow: 0 0 0 4px rgba(99,102,241,0.1); }
}

.anim-up { animation: fadeUp 0.6s ease-out forwards; opacity: 0; }
.anim-scale { animation: scaleIn 0.5s ease-out forwards; opacity: 0; }
.expand-panel { animation: expandIn 0.25s ease-out forwards; overflow: hidden; }
.test-active { animation: softPulse 2s ease-in-out infinite; }

.d1 { animation-delay: 0.1s; }
.d2 { animation-delay: 0.2s; }
.d3 { animation-delay: 0.3s; }
.d4 { animation-delay: 0.4s; }
.d5 { animation-delay: 0.5s; }
.d6 { animation-delay: 0.6s; }
.d7 { animation-delay: 0.7s; }
.d8 { animation-delay: 0.8s; }
.d9 { animation-delay: 0.9s; }

/* === Neumorphic cards === */
.neu-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-card);
}
.neu-card-hover:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

/* === Glow effects === */
.glow-indigo {
  box-shadow: var(--shadow-glow);
}
.glow-indigo-btn {
  box-shadow: var(--shadow-btn);
}

/* === Shimmer text — light mode uses darker indigos on light bg === */
.shimmer-text {
  background: linear-gradient(90deg, #4f46e5 0%, #6366f1 25%, #4f46e5 50%, #818cf8 75%, #4f46e5 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: shimmer 4s linear infinite;
}
html.dark .shimmer-text {
  background: linear-gradient(90deg, #818cf8 0%, #c7d2fe 25%, #818cf8 50%, #a5b4fc 75%, #818cf8 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* === Logo pulse === */
.logo-pulse {
  position: relative;
  animation: glow-pulse 3s ease-in-out infinite, float 4s ease-in-out infinite;
}
.logo-pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 1rem;
  background: #6366f1;
  animation: pulse-ring 2.5s ease-out infinite;
  z-index: -1;
}

/* === Grid background — light mode === */
.grid-bg {
  background-image:
    radial-gradient(circle at 50% 0%, rgba(79,70,229,0.06) 0%, transparent 50%),
    linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
  background-size: 100% 100%, 48px 48px, 48px 48px;
}
html.dark .grid-bg {
  background-image:
    radial-gradient(circle at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 50%),
    linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 100% 100%, 48px 48px, 48px 48px;
}

/* === Step connector === */
.step-connector {
  height: 2px;
  background: linear-gradient(90deg, rgba(79,70,229,0.3), rgba(79,70,229,0.1));
}

/* === New case card === */
.new-case-card {
  border-color: rgba(79,70,229,0.2);
  background: rgba(79,70,229,0.04);
}
.new-case-card:hover {
  border-color: rgba(79,70,229,0.4);
  background: rgba(79,70,229,0.08);
}
html.dark .new-case-card {
  border-color: rgba(99,102,241,0.3);
  background: rgba(99,102,241,0.05);
}
html.dark .new-case-card:hover {
  border-color: rgba(99,102,241,0.5);
  background: rgba(99,102,241,0.1);
}

.case-tag { transition: all 0.15s ease; }
```

- [ ] **Step 2: Verify the app builds with the new CSS**

Run: `pnpm build`
Expected: Build succeeds. The app will look broken because components still use hardcoded colors, but CSS compiles.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/globals.css
git commit -m "feat(theme): add semantic CSS token system with light/dark support"
```

---

### Task 2: Flash Prevention & Default Settings

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/main/services/settings.ts`

- [ ] **Step 1: Add flash prevention script to index.html**

In `src/renderer/index.html`, add an inline script in the `<head>` section, before any CSS loads:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Birdbrain</title>
    <script>
      if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark')
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Change default theme to 'light' in settings.ts**

In `src/main/services/settings.ts`, change line 16:

```typescript
  theme: 'light',
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html src/main/services/settings.ts
git commit -m "feat(theme): add flash prevention script and set light as default theme"
```

---

### Task 3: useTheme Hook

**Files:**
- Create: `src/renderer/hooks/useTheme.ts`

- [ ] **Step 1: Create the useTheme hook**

Create `src/renderer/hooks/useTheme.ts`:

```typescript
import { useState, useCallback, useEffect } from 'react'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return 'light'
}

function applyTheme(theme: Theme): void {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'

    document.documentElement.classList.add('transitioning')
    applyTheme(next)
    setTheme(next)
    localStorage.setItem('theme', next)
    window.birdbrain.settings.update({ theme: next })

    setTimeout(() => {
      document.documentElement.classList.remove('transitioning')
    }, 400)
  }, [theme])

  return { theme, toggleTheme } as const
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `pnpm build`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/useTheme.ts
git commit -m "feat(theme): add useTheme hook with toggle, localStorage, and IPC persistence"
```

---

### Task 4: TopBar — Theme Toggle Button + Color Migration

**Files:**
- Modify: `src/renderer/components/layout/TopBar.tsx`

- [ ] **Step 1: Add theme toggle and migrate colors**

Replace the full contents of `src/renderer/components/layout/TopBar.tsx` with:

```tsx
import { Radar, ChevronRight, Settings, Bell, Sun, Moon } from 'lucide-react'
import { Link, useNavigate, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { casesQueryOptions } from '@renderer/lib/queries'
import { useTheme } from '@renderer/hooks/useTheme'

export function TopBar() {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { theme, toggleTheme } = useTheme()

  const caseMatch = matchRoute({ to: '/cases/$caseId', fuzzy: true })
  const isDashboard = matchRoute({ to: '/' }) !== false && !caseMatch
  const activeCaseId = caseMatch ? (caseMatch as { caseId: string }).caseId : null
  const activeCase = activeCaseId ? cases.find((c) => c.id === activeCaseId) : null

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      {/* Logo + Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="glow-indigo flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <Radar className="h-4 w-4 text-white" />
          </div>
          <span className="font-display text-sm font-extrabold tracking-tight text-text-primary">
            Birdbrain
          </span>
          <span className="ml-1 rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-muted">
            v2.0
          </span>
        </div>

        {activeCaseId && (
          <div className="flex items-center gap-1.5 text-sm">
            <Link to="/" className="text-text-muted hover:text-text-secondary">
              Investigations
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-text-faint" />
            <span className="text-text-secondary">{activeCase?.name ?? 'Untitled'}</span>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {isDashboard ? (
        <div className="flex items-center gap-3">
          <CaptureHealth />
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary transition-colors">
            <Bell className="h-4 w-4" />
          </button>
          <button
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-accent transition-all duration-300"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => navigate({ to: '/settings' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary transition-colors"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <SearchBar />

          <div className="flex items-center gap-2">
            <SessionControls />

            {sessionActive && (
              <div className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                <span className="text-[11px] font-medium text-red-400">Recording</span>
              </div>
            )}

            <ConnectionStatus />
            <CaptureHealth />

            <button
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-accent transition-all duration-300"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              onClick={() => navigate({ to: '/settings' })}
              className="rounded p-1.5 text-text-muted hover:bg-elevated hover:text-text-secondary"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </header>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/TopBar.tsx
git commit -m "feat(theme): add theme toggle to TopBar and migrate to semantic tokens"
```

---

### Task 5: AppearanceConfig — Functional Theme Selector

**Files:**
- Modify: `src/renderer/components/settings/AppearanceConfig.tsx`

- [ ] **Step 1: Make the theme selector functional**

Replace the full contents of `src/renderer/components/settings/AppearanceConfig.tsx`:

```tsx
import { useTheme } from '@renderer/hooks/useTheme'

export function AppearanceConfig() {
  const { theme, toggleTheme } = useTheme()

  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Appearance</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-text-muted">Theme</label>
          <div className="flex gap-3">
            <button
              onClick={() => theme !== 'light' && toggleTheme()}
              className={`flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors ${
                theme === 'light'
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
              }`}
            >
              Light
            </button>
            <button
              onClick={() => theme !== 'dark' && toggleTheme()}
              className={`flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors ${
                theme === 'dark'
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
              }`}
            >
              Dark
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-primary">Reduce motion</div>
            <div className="text-xs text-text-muted">Disable animations throughout the app</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={false}
            disabled
            className="relative inline-flex h-5 w-9 items-center rounded-full bg-text-faint opacity-50"
          >
            <span className="inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white" />
          </button>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/settings/AppearanceConfig.tsx
git commit -m "feat(theme): make AppearanceConfig a functional theme selector"
```

---

### Task 6: Dashboard Components — Color Migration

**Files:**
- Modify: `src/renderer/components/dashboard/HeroSection.tsx`
- Modify: `src/renderer/components/dashboard/RecentCases.tsx`
- Modify: `src/renderer/components/dashboard/CaseCard.tsx`
- Modify: `src/renderer/components/dashboard/QuickStartGuide.tsx`
- Modify: `src/renderer/components/dashboard/ExtensionBanner.tsx`
- Modify: `src/renderer/components/dashboard/DashboardFooter.tsx`

Migrate all hardcoded dark colors in dashboard components to semantic tokens. The mapping:

| Old | New |
|---|---|
| `text-slate-50`, `text-white` | `text-text-primary` |
| `text-slate-100` | `text-text-primary` |
| `text-slate-300`, `text-slate-200` | `text-text-secondary` |
| `text-slate-400`, `text-slate-500` | `text-text-muted` |
| `text-slate-600`, `text-slate-700` | `text-text-faint` |
| `text-indigo-400` (interactive) | `text-accent` |
| `text-indigo-300` (lighter) | `text-accent` |
| `text-indigo-600` | `text-accent` |
| `bg-slate-900` | `bg-surface` |
| `bg-slate-800` | `bg-card` or `bg-elevated` |
| `border-slate-800`, `border-slate-700` | `border-border-strong` |
| `border-white/[0.06]` | `border-border` |
| `border-white/[0.08]` | `border-border-strong` |
| `hover:bg-white/[0.04]` | `hover:bg-elevated` |
| `bg-indigo-600` (buttons) | `bg-accent` |
| `hover:bg-indigo-500` (buttons) | `hover:bg-accent-hover` |
| `bg-indigo-500/10`, `bg-indigo-950/50` | `bg-accent-subtle` |
| `bg-indigo-500/15`, `bg-indigo-500/20` | `bg-accent-subtle` |

- [ ] **Step 1: Migrate each file**

Apply the color mapping above to every className in:
1. `HeroSection.tsx` — swap text colors, keep `bg-indigo-600` on logo/CTA as `bg-accent`, keyboard hints use `bg-surface` and `border-border-strong`
2. `RecentCases.tsx` — text colors, border/bg on count badge
3. `CaseCard.tsx` — text colors, borders, context menu bg uses `bg-elevated`, hover states
4. `QuickStartGuide.tsx` — section header text, step number badge, descriptions. Note: entity-colored icon backgrounds (emerald, amber, sky, indigo with `/50` opacity) stay as-is since they use raw entity palette colors
5. `ExtensionBanner.tsx` — text colors, button bg. Note: emerald status colors stay raw
6. `DashboardFooter.tsx` — text colors, border

Key judgments for each file:
- `text-white` on dark backgrounds (buttons with `bg-accent`) stays as `text-white` since buttons are always indigo
- Entity/status badge raw colors (emerald, red, amber) stay unchanged
- `bg-indigo-950` and similar very-dark accent backgrounds become `bg-accent-subtle`
- `border-indigo-800/30` and similar become `border-accent/20`
- `shadow-indigo-500/40` stays as-is (accent glow on buttons)

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/dashboard/
git commit -m "feat(theme): migrate dashboard components to semantic tokens"
```

---

### Task 7: Capture Components — Color Migration

**Files:**
- Modify: `src/renderer/components/captures/CaptureList.tsx`
- Modify: `src/renderer/components/captures/CaptureItem.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx`

- [ ] **Step 1: Migrate CaptureList.tsx**

Apply the same color mapping:
- `bg-slate-900` → `bg-surface`
- `border-white/[0.06]` → `border-border`
- `bg-white/[0.03]` → `bg-card`
- `text-slate-300` → `text-text-secondary`
- `text-slate-500`, `text-slate-600` → `text-text-muted` or `text-text-faint`
- `placeholder-slate-600` → `placeholder-text-faint`
- `hover:bg-white/[0.04]` → `hover:bg-elevated`
- `focus:border-indigo-500/30` → `focus:border-accent/30`

- [ ] **Step 2: Migrate CaptureItem.tsx**

- `text-slate-200` → `text-text-secondary`
- `text-slate-500` → `text-text-muted`
- `text-slate-600` → `text-text-faint`
- `border-indigo-500/35 bg-indigo-500/15` (selected state) → `border-accent/35 bg-accent-subtle`
- `hover:bg-white/[0.04]` → `hover:bg-elevated`
- Note: `THUMB_COLORS` gradient colors can remain as-is — they're decorative thumbnail colors that work on both light/dark backgrounds

- [ ] **Step 3: Migrate CaptureViewer.tsx**

This is the most complex component. Apply the mapping:
- `bg-black` → `bg-canvas`
- `text-slate-500` (empty state) → `text-text-muted`
- `text-white` (title) → `text-text-primary`
- `border-white/[0.06]` → `border-border`
- `bg-slate-800/50` (browser chrome) → `bg-elevated`
- `bg-white/[0.06]` (URL bar) → `bg-surface`
- `bg-slate-900/50` (bottom panel) → `bg-surface`
- `text-indigo-400` (active tab) → `text-accent`
- `bg-indigo-400` (tab indicator) → `bg-accent`
- `text-slate-300` → `text-text-secondary`
- `text-slate-400` → `text-text-muted`
- `text-slate-600` → `text-text-faint`
- `bg-slate-800` (tag menu dropdown) → `bg-elevated`
- `hover:bg-white/[0.06]` → `hover:bg-elevated`
- `border-dashed border-white/[0.08]` → `border-dashed border-border-strong`
- `hover:border-white/[0.15]` → `hover:border-accent/30`
- `bg-black/60` (modal overlay) → `bg-canvas/60` (or keep `bg-black/60` since overlays should be dark in both modes)
- Delete confirm dialog: `text-white` → `text-text-primary`, `text-slate-400` → `text-text-muted`

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/
git commit -m "feat(theme): migrate capture components to semantic tokens"
```

---

### Task 8: Case Components — Color Migration

**Files:**
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx`
- Modify: `src/renderer/components/cases/CaseOverview.tsx`
- Modify: `src/renderer/components/cases/CaseSwitcher.tsx`
- Modify: `src/renderer/components/cases/CreateCaseDialog.tsx`
- Modify: `src/renderer/components/cases/NewCaseWizard.tsx`

- [ ] **Step 1: Migrate CaseWorkspace.tsx**

- `bg-slate-900` → `bg-surface`
- `border-white/[0.06]` → `border-border`
- `bg-indigo-500/15` → `bg-accent-subtle`
- `text-indigo-400` → `text-accent`
- `text-indigo-300` → `text-accent`
- `text-slate-500` → `text-text-muted`
- `hover:text-slate-200` → `hover:text-text-primary`
- `hover:bg-white/[0.04]` → `hover:bg-elevated`
- `bg-slate-800` → `bg-elevated`
- `text-slate-400` → `text-text-muted`

- [ ] **Step 2: Migrate CaseOverview.tsx**

- `text-white` (headings, stat values) → `text-text-primary`
- `text-slate-200` (section headers) → `text-text-primary`
- `text-slate-300` (body text, domain list) → `text-text-secondary`
- `text-slate-400` (labels) → `text-text-muted`
- `text-slate-500` → `text-text-muted`
- `text-slate-600` → `text-text-faint`
- `bg-indigo-500/10` → `bg-accent-subtle`
- `text-indigo-400` → `text-accent`
- `bg-indigo-500/15` → `bg-accent-subtle`
- `border-white/[0.08]` → `border-border-strong`
- `bg-slate-800` (domain count badge, buttons) → `bg-elevated`
- `hover:bg-slate-700` → `hover:bg-elevated`
- `bg-slate-800` (progress bar track) → `bg-border-strong` or use a custom approach
- `border-indigo-500` (editing input) → `border-accent`
- `bg-slate-800` (editing input bg) → `bg-elevated`
- `border-slate-800/60` → `border-border`

- [ ] **Step 3: Migrate CaseSwitcher.tsx**

This component uses `neutral-*` colors (older style) — normalize to semantic tokens:
- `text-neutral-400` → `text-text-muted`
- `text-neutral-100` → `text-text-primary`
- `bg-neutral-800` → `bg-elevated`
- `border-neutral-700` → `border-border-strong`
- `hover:bg-neutral-700` → `hover:bg-elevated`
- `bg-neutral-700/50 text-white` → `bg-accent-subtle text-text-primary`
- `text-neutral-300` → `text-text-secondary`

- [ ] **Step 4: Migrate CreateCaseDialog.tsx**

Same `neutral-*` normalization:
- `bg-black/60` (overlay) → keep `bg-black/60`
- `bg-neutral-900` → `bg-card`
- `border-neutral-700` → `border-border-strong`
- `text-neutral-100` → `text-text-primary`
- `text-neutral-400` → `text-text-muted`
- `bg-neutral-800` → `bg-elevated`
- `focus:border-amber-600` → `focus:border-accent`
- `bg-amber-600` → `bg-accent`
- `hover:bg-amber-500` → `hover:bg-accent-hover`
- `text-neutral-200` → `text-text-primary`

- [ ] **Step 5: Migrate NewCaseWizard.tsx**

- `bg-white/[0.15]` → `bg-border-strong`
- `text-white` (headings) → `text-text-primary`
- `text-slate-300`, `text-slate-400` → `text-text-secondary`, `text-text-muted`
- `text-slate-500` → `text-text-muted`
- `bg-slate-800` → `bg-elevated`
- `border-white/[0.08]` → `border-border-strong`
- `border-indigo-500` → `border-accent`
- `bg-indigo-500/10` → `bg-accent-subtle`
- `hover:border-white/[0.15]` → `hover:border-accent/30`
- `bg-indigo-600` → `bg-accent`
- `hover:bg-indigo-500` → `hover:bg-accent-hover`
- `border-white/[0.06]` → `border-border`
- `hover:bg-white/[0.04]` → `hover:bg-elevated`

- [ ] **Step 6: Verify build**

Run: `pnpm build`
Expected: Compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/cases/
git commit -m "feat(theme): migrate case components to semantic tokens"
```

---

### Task 9: Selector Components — Color Migration

**Files:**
- Modify: `src/renderer/components/selectors/SelectorTable.tsx`
- Modify: `src/renderer/components/selectors/SelectorTableRow.tsx`
- Modify: `src/renderer/components/selectors/SelectorsOverview.tsx`
- Modify: `src/renderer/components/selectors/CreateSelectorCard.tsx`
- Modify: `src/renderer/components/selectors/SelectorFilterFooter.tsx`

- [ ] **Step 1: Migrate all selector components**

Apply the standard mapping to each file:
- `border-white/[0.06]` → `border-border`
- `border-white/[0.08]` → `border-border-strong`
- `bg-black` (inputs) → `bg-canvas`
- `bg-white/[0.02]` (table header) → `bg-surface`
- `bg-white/[0.03]` (hover row) → `hover:bg-surface`
- `text-slate-100` → `text-text-primary`
- `text-slate-300` → `text-text-secondary`
- `text-slate-400` → `text-text-muted`
- `text-slate-500`, `text-slate-600` → `text-text-muted` or `text-text-faint`
- `bg-indigo-500/15` → `bg-accent-subtle`
- `text-indigo-300`, `text-indigo-400` → `text-accent`
- `bg-indigo-600` → `bg-accent`
- `bg-slate-800` (preview cards) → `bg-elevated`
- `bg-slate-800/50` → `bg-elevated`
- `hover:bg-white/[0.04]` → `hover:bg-elevated`
- `hover:bg-white/[0.08]` → `hover:bg-elevated`
- `bg-white/[0.04]` → `bg-surface`
- `bg-white/[0.06]` → `bg-surface`
- `bg-indigo-500/20` → `bg-accent-subtle`
- `bg-indigo-500/30` (match highlights) → keep as-is (accent highlight color, works in both modes)
- `text-indigo-200` (match text) → `text-accent`
- `bg-slate-900` (footer) → `bg-surface`
- `bg-indigo-500/[0.04]` (test panel) → `bg-accent-subtle`
- `border-indigo-500/20` → `border-accent/20`
- `border-indigo-500/30` → `border-accent/30`
- `focus:border-indigo-500/40` → `focus:border-accent/40`
- `focus:ring-indigo-500/25` → `focus:ring-accent/25`

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/selectors/
git commit -m "feat(theme): migrate selector components to semantic tokens"
```

---

### Task 10: Settings, Search, Status, Export, Tag Components — Color Migration

**Files:**
- Modify: `src/renderer/components/settings/SettingsView.tsx`
- Modify: `src/renderer/components/settings/StorageConfig.tsx`
- Modify: `src/renderer/components/settings/AIConfig.tsx`
- Modify: `src/renderer/components/settings/CapturePreferences.tsx`
- Modify: `src/renderer/components/settings/About.tsx`
- Modify: `src/renderer/components/search/SearchBar.tsx`
- Modify: `src/renderer/components/status/SessionControls.tsx`
- Modify: `src/renderer/components/status/ConnectionStatus.tsx`
- Modify: `src/renderer/components/status/CaptureHealth.tsx`
- Modify: `src/renderer/components/export/ExportDialog.tsx`
- Modify: `src/renderer/components/tags/TagManager.tsx`

- [ ] **Step 1: Migrate SettingsView.tsx**

- `border-white/[0.06]` → `border-border`
- `bg-indigo-500/15` → `bg-accent-subtle`
- `text-indigo-400` → `text-accent`
- `text-slate-400` → `text-text-muted`
- `text-slate-200` → `text-text-primary`
- `hover:bg-white/[0.04]` → `hover:bg-elevated`
- `hover:text-slate-200` → `hover:text-text-primary`

- [ ] **Step 2: Migrate StorageConfig.tsx**

- `text-slate-200` (heading) → `text-text-primary`
- `text-slate-400` (labels) → `text-text-muted`
- `bg-slate-800` (display/inputs) → `bg-elevated`
- `border-white/[0.08]` → `border-border-strong`
- `text-white` (input text) → `text-text-primary`
- `focus:border-indigo-500` → `focus:border-accent`

- [ ] **Step 3: Migrate AIConfig.tsx**

- `text-slate-200` → `text-text-primary`
- `text-slate-400` → `text-text-muted`

- [ ] **Step 4: Migrate CapturePreferences.tsx**

- `text-slate-300` → `text-text-secondary`
- `text-slate-400` → `text-text-muted`
- `text-slate-500` → `text-text-muted`
- `bg-slate-800` → `bg-elevated`
- `border-white/[0.08]` → `border-border-strong`
- `text-white` → `text-text-primary`
- `focus:border-indigo-500` → `focus:border-accent`
- `hover:bg-white/[0.06]` → `hover:bg-elevated`
- `hover:text-red-400` stays (status color)

- [ ] **Step 5: Migrate About.tsx**

- `text-slate-200` → `text-text-primary`
- `text-slate-400` → `text-text-muted`
- `text-slate-300` → `text-text-secondary`
- `text-slate-500` → `text-text-muted`
- `text-indigo-400` → `text-accent`
- `hover:text-indigo-300` → `hover:text-accent-hover`

- [ ] **Step 6: Migrate SearchBar.tsx**

- `text-slate-500` → `text-text-muted`
- `hover:text-slate-300` → `hover:text-text-secondary`
- `border-white/[0.08]` → `border-border-strong`
- `bg-slate-800` → `bg-elevated`
- `focus-within:border-indigo-500/40` → `focus-within:border-accent/40`
- `focus-within:ring-indigo-500/25` → `focus-within:ring-accent/25`
- `text-slate-100` → `text-text-primary`
- `placeholder:text-slate-600` → `placeholder:text-text-faint`
- `text-slate-200` → `text-text-primary`

- [ ] **Step 7: Migrate SessionControls.tsx**

- `text-slate-400` → `text-text-muted`
- `text-slate-500` → `text-text-muted`
- `bg-indigo-600` (toggle on) → `bg-accent`
- `bg-slate-600` (toggle off) → `bg-text-faint`

- [ ] **Step 8: Migrate ConnectionStatus.tsx**

- `border-slate-700` → `border-border-strong`
- `bg-slate-800` → `bg-elevated`
- `text-slate-500` → `text-text-muted`
- Emerald status colors stay raw

- [ ] **Step 9: Migrate CaptureHealth.tsx**

- `border-slate-700` → `border-border-strong`
- `bg-slate-800` → `bg-elevated`
- `text-slate-500` → `text-text-muted`
- `text-slate-300` → `text-text-secondary`
- `text-slate-400` → `text-text-muted`
- `text-slate-600` → `text-text-faint`
- `bg-slate-900` (dropdown) → `bg-surface`
- `border-white/[0.06]` → `border-border`
- `hover:bg-slate-700` → `hover:bg-elevated`
- Status colors (emerald, red, amber, blue) stay raw

- [ ] **Step 10: Migrate ExportDialog.tsx**

- `bg-black/60` overlay stays
- `text-white` (heading) → `text-text-primary`
- `text-slate-400` → `text-text-muted`
- `text-slate-300` → `text-text-secondary`
- `bg-slate-800` → `bg-elevated`
- `border-white/[0.08]` → `border-border-strong`
- `focus:border-indigo-500` → `focus:border-accent`
- `text-slate-200` → `text-text-primary`
- `bg-indigo-600` → `bg-accent`
- `hover:bg-indigo-500` → `hover:bg-accent-hover`

- [ ] **Step 11: Migrate TagManager.tsx**

- `bg-black/60` overlay stays
- `text-white` (heading, input text) → `text-text-primary`
- `border-white/[0.08]` → `border-border-strong`
- `bg-slate-800` → `bg-elevated`
- `focus:border-indigo-500` → `focus:border-accent`
- `ring-offset-slate-900` → `ring-offset-card`
- `bg-indigo-600` → `bg-accent`
- `hover:bg-indigo-500` → `hover:bg-accent-hover`
- `text-slate-300` → `text-text-secondary`
- `hover:bg-white/[0.04]` → `hover:bg-elevated`
- `text-slate-600` → `text-text-faint`
- `hover:text-red-400` stays
- `text-slate-400` → `text-text-muted`

- [ ] **Step 12: Verify build**

Run: `pnpm build`
Expected: Compiles without errors.

- [ ] **Step 13: Commit**

```bash
git add src/renderer/components/settings/ src/renderer/components/search/ src/renderer/components/status/ src/renderer/components/export/ src/renderer/components/tags/TagManager.tsx
git commit -m "feat(theme): migrate settings, search, status, export, and tag components to semantic tokens"
```

---

### Task 11: Visual Verification & Polish

**Files:** None created — this is a verification pass.

- [ ] **Step 1: Start dev server and verify light mode**

Run: `pnpm dev`

Check each page in light mode (default):
1. Dashboard — hero section, case cards, quick start, extension banner, footer
2. New Case Wizard — form, type selector, selector presets
3. Case Workspace — tab bar, overview stats, captures sidebar, capture viewer
4. Settings — all tabs (AI, Capture, Storage, Appearance, About)

Look for:
- Any remaining dark-mode hardcoded colors that were missed
- Text contrast issues (light text on light background)
- Borders that are invisible
- Shadows that are too heavy or too light

- [ ] **Step 2: Toggle to dark mode and verify**

Click the Moon icon in the TopBar. Verify:
- Smooth 0.4s transition
- All surfaces swap to dark values
- Text is legible
- `.neu-card` shadows are stronger
- `.shimmer-text` uses lighter gradient
- `.grid-bg` uses lighter grid lines
- Scrollbar swaps colors

- [ ] **Step 3: Reload and verify persistence**

Refresh the page (Ctrl+R). Verify:
- Theme is preserved (no flash)
- `localStorage.theme` is set

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -u
git commit -m "fix(theme): visual polish from verification pass"
```

---

### Task 12: E2E Theme Toggle Test

**Files:**
- Modify: `e2e/app-lifecycle.spec.ts`

- [ ] **Step 1: Add a theme toggle E2E test**

Add to the end of `e2e/app-lifecycle.spec.ts`:

```typescript
test('theme toggle persists between reloads', async () => {
  const page = await electronApp.firstWindow()

  // App should start in light mode (no .dark class)
  const htmlClass = await page.evaluate(() => document.documentElement.className)
  expect(htmlClass).not.toContain('dark')

  // Find and click the theme toggle (Moon icon button)
  const themeToggle = page.locator('button[title="Switch to dark mode"]')
  await themeToggle.click()

  // Should now have .dark class
  const darkClass = await page.evaluate(() => document.documentElement.className)
  expect(darkClass).toContain('dark')

  // Reload and verify persistence
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  const afterReload = await page.evaluate(() => document.documentElement.className)
  expect(afterReload).toContain('dark')
})
```

- [ ] **Step 2: Run the E2E tests**

Run: `pnpm test:e2e`
Expected: All tests pass, including the new theme toggle test.

- [ ] **Step 3: Commit**

```bash
git add e2e/app-lifecycle.spec.ts
git commit -m "test(theme): add E2E test for theme toggle persistence"
```
