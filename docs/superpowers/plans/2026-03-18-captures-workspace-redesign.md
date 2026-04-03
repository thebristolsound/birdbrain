# Full App Redesign (OLED Dark Mode) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire Birdbrain app to match the SuperDesign OLED Dark Mode drafts — covering the Electron app (Dashboard, Captures, Overview, Entities, Analysis, Selectors, Settings, New Case Wizard) and Chrome Extension (Popup, Sidebar). This transforms the current neutral/amber theme into an OLED-black/indigo/slate design system with Plus Jakarta Sans typography, Lucide icons, and polished UI components.

**Architecture:** Foundation-first approach — install deps, update theme tokens, then redesign each page as an independent task. The component hierarchy changes in several places (TopBar gets breadcrumbs, workspace tabs get icons, Dashboard becomes a rich landing page, CreateCaseDialog becomes a multi-step wizard, Settings gets sidebar nav). State management (Zustand) needs a new `new-case-wizard` app mode. Database needs a `type` column on cases.

**Tech Stack:** React 19, Tailwind CSS v4, Zustand, lucide-react (new), @fontsource (Plus Jakarta Sans, DM Sans, JetBrains Mono)

**Design Reference:** SuperDesign project `0ee09075-9ca1-4004-a3e4-701a561e82bf` — 12 OLED Dark Mode drafts. HTML files saved in `.superdesign/drafts/`.

---

## Phased Execution Order

| Phase | Task | Scope | Risk |
|-------|------|-------|------|
| 1 | Foundation | Deps, fonts, theme, globals.css | Low |
| 2 | App Shell | TopBar, MainContent, App.tsx | Medium |
| 3 | Workspace Tabs | CaseWorkspace tab bar with icons | Low |
| 4 | Captures Workspace | CaptureList sidebar, CaptureItem, CaptureViewer | Medium |
| 5 | Dashboard | Full redesign with rich case cards | Medium |
| 6 | Case Overview | Two-column layout, investigation health | Medium |
| 7 | Entities Tab | Filter chips, batch selection, visual bars | High |
| 8 | Analysis Tab | Color migration + card styling | Low |
| 9 | Selectors Tab | Regex highlighting, test preview, toggles | High |
| 10 | Settings | Sidebar nav, Appearance page | Medium |
| 11 | New Case Wizard | Multi-step wizard, schema migration | High |
| 12 | Extension Popup | Visual redesign with entity highlights | Medium |
| 13 | Extension Sidebar | Multi-purpose panel redesign | High |
| 14 | Cleanup | E2E tests, dead code, BrowserWindow bg | Low |

---

## Global Color Migration Reference

This table applies to ALL components across tasks 2-14. When restyling a component, use this mapping:

| Old Class | New Class |
|-----------|-----------|
| `bg-neutral-950` / `bg-neutral-950` | `bg-black` |
| `bg-neutral-900` | `bg-slate-900` or `bg-[#0f172a]` |
| `bg-neutral-800` | `bg-slate-800` or `bg-[#1e293b]` |
| `border-neutral-800` | `border-white/[0.06]` |
| `border-neutral-700` | `border-white/[0.08]` |
| `text-neutral-100` | `text-white` or `text-slate-100` |
| `text-neutral-200` | `text-slate-200` |
| `text-neutral-300` | `text-slate-300` |
| `text-neutral-400` | `text-slate-400` |
| `text-neutral-500` | `text-slate-500` |
| `text-neutral-600` | `text-slate-600` |
| `bg-amber-600` | `bg-indigo-600` |
| `hover:bg-amber-500` | `hover:bg-indigo-500` |
| `text-amber-500` / `text-amber-600` | `text-indigo-400` |
| `border-amber-600` | `border-indigo-500` |
| `focus:border-amber-600` | `focus:border-indigo-500/40 focus:ring-2 focus:ring-indigo-500/25` |
| `border-b-2 border-blue-500 text-blue-400` | `text-indigo-400` with `::after` bar |
| `hover:bg-neutral-700` | `hover:bg-white/[0.06]` |
| `hover:bg-neutral-800` | `hover:bg-white/[0.04]` |
| `rounded-lg` (cards) | `rounded-2xl` |
| `bg-green-950/30` | `bg-emerald-500/10` |
| `border-green-800` | `border-emerald-500/20` |
| `bg-red-950/50` | `bg-red-500/10` |
| `bg-amber-600/20 text-amber-400` | `bg-indigo-500/20 text-indigo-300` |

---

## Task 1: Foundation — Dependencies, Fonts, Theme

**Files:**
- Modify: `package.json`
- Modify: `src/renderer/styles/globals.css`
- Modify: `src/renderer/App.tsx`

### Step-by-step

- [ ] **Step 1: Install dependencies**

```bash
pnpm add lucide-react @fontsource-variable/plus-jakarta-sans @fontsource-variable/dm-sans @fontsource-variable/jetbrains-mono
```

- [ ] **Step 2: Replace globals.css**

```css
@import "tailwindcss";
@import "@fontsource-variable/plus-jakarta-sans";
@import "@fontsource-variable/dm-sans";
@import "@fontsource-variable/jetbrains-mono";

@theme {
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

  --font-display: "Plus Jakarta Sans Variable", sans-serif;
  --font-body: "DM Sans Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
}

body {
  @apply bg-black text-slate-300;
  font-family: var(--font-body);
}

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #334155; border-radius: 6px; }
::-webkit-scrollbar-thumb:hover { background: #475569; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.anim-in { animation: fadeIn 0.4s ease-out forwards; opacity: 0; }

.neu-card {
  background: #1e293b;
  border: 1px solid rgba(255,255,255,0.06);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3);
}
.neu-card-hover:hover {
  box-shadow: 0 2px 12px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.4);
  transform: translateY(-1px);
}

.glow-indigo {
  box-shadow: 0 0 20px rgba(99,102,241,0.25), 0 0 60px rgba(99,102,241,0.08);
}
.glow-indigo-btn {
  box-shadow: 0 4px 20px rgba(99,102,241,0.4), 0 0 40px rgba(99,102,241,0.12);
}
```

- [ ] **Step 3: Update App.tsx root classes**

Change root div from `bg-neutral-950 text-neutral-100` to `bg-black text-slate-300`.

- [ ] **Step 4: Verify app renders**

```bash
pnpm dev
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/styles/globals.css src/renderer/App.tsx
git commit -m "feat: add OLED dark theme foundation with indigo accents, fonts, and icons"
```

---

## Task 2: App Shell — TopBar Redesign

**Files:**
- Modify: `src/renderer/components/layout/TopBar.tsx`
- Modify: `src/renderer/components/status/ConnectionStatus.tsx`
- Modify: `src/renderer/components/layout/MainContent.tsx`
- Modify: `src/renderer/components/status/SessionControls.tsx`
- Modify: `src/renderer/components/search/SearchBar.tsx`

### Changes from design

TopBar gets:
- Indigo radar icon logo with glow + "Birdbrain" in Plus Jakarta Sans
- Breadcrumb nav when in workspace (Investigations > Case Name)
- SearchBar and SessionControls stay (preserve functionality) but get restyled
- Recording/Connected badges with refined border styling
- Settings icon button

### Step-by-step

- [ ] **Step 1: Rewrite TopBar.tsx**

Add `lucide-react` imports for `Radar`, `ChevronRight`, `Settings`. Replace back-arrow/CaseSwitcher with breadcrumb. Keep `SearchBar` and `SessionControls` imports. Use the new slate/indigo classes from the global migration table.

Key classes: header `h-14 bg-slate-900 border-white/[0.06]`, logo `bg-indigo-600 glow-indigo`, breadcrumb `text-slate-500`, recording badge `bg-red-500/10 border-red-500/20`.

- [ ] **Step 2: Update ConnectionStatus.tsx**

Replace neutral colors with slate/emerald equivalents. Recording state returns null (badge moved to TopBar). Connected: `bg-emerald-500/10 border-emerald-500/20`. Waiting: `bg-slate-800 border-slate-700`.

- [ ] **Step 3: Restyle SessionControls.tsx**

Apply color migration: `bg-neutral-800` → `bg-slate-800`, `border-neutral-700` → `border-white/[0.08]`, amber toggle → indigo toggle (`bg-indigo-600`).

- [ ] **Step 4: Restyle SearchBar.tsx**

Apply color migration: input `bg-neutral-800` → `bg-slate-800`, border → `border-white/[0.08]`, focus → `focus:border-indigo-500/40 focus:ring-2 focus:ring-indigo-500/25`.

- [ ] **Step 5: Update MainContent.tsx backgrounds**

Replace `bg-neutral-950` with `bg-black`.

- [ ] **Step 6: Verify and commit**

```bash
pnpm dev
git add src/renderer/components/layout/ src/renderer/components/status/ src/renderer/components/search/
git commit -m "feat: redesign TopBar with indigo logo, breadcrumb nav, and refined badges"
```

---

## Task 3: Workspace Tabs — Icons & Count Badges

**Files:**
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx`

### Changes from design

- Remove case header (name, rename, kebab menu) — case name shown in TopBar breadcrumb
- Tab bar as separate visual row with icons per tab
- Captures tab shows count badge
- Active tab: indigo background tint with `rounded-t-lg`
- Captures view: sidebar + main panel layout (no wrapping padding)

### Step-by-step

- [ ] **Step 1: Rewrite CaseWorkspace.tsx**

Import `lucide-react` icons: `LayoutDashboard`, `Layers`, `Fingerprint`, `Brain`, `Crosshair`. Remove rename/delete/kebab menu state and handlers. Tab bar: `h-11 bg-slate-900 border-white/[0.06]`. Active tab: `bg-indigo-500/15 text-indigo-400`. Captures layout: sidebar + main flex panel without wrapping `p-6`.

- [ ] **Step 2: Verify and commit**

```bash
git add src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "feat: restructure workspace tabs with icons and count badges"
```

---

## Task 4: Captures Workspace — List, Items, Viewer

**Files:**
- Modify: `src/renderer/components/captures/CaptureList.tsx`
- Modify: `src/renderer/components/captures/CaptureItem.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx`
- Modify: `src/renderer/components/tags/TagBadge.tsx`

### Changes from design

**CaptureList**: 300px sidebar with search, sort/filter buttons, selector filter indicator, footer count.

**CaptureItem**: Rich card with colored gradient thumbnail placeholder, rounded-xl border, indigo active highlight, relative timestamps.

**CaptureViewer**: Header with prev/next arrows + title/URL/timestamp + verified badge + download/external/trash buttons. Screenshot in faux browser chrome card. Sub-tabs at bottom with icons + extract entities glow button. Tag bar with styled chips + keyboard hints.

**TagBadge**: Rounded-lg chip with border, hover scale.

### Step-by-step

- [ ] **Step 1: Rewrite CaptureList.tsx**

300px `aside` with search, sort/filter, selector filter indicator, scrollable capture list, footer. Import `Search`, `ArrowUpDown`, `Filter`, `Crosshair`, `X` from lucide-react.

- [ ] **Step 2: Rewrite CaptureItem.tsx**

Rich card with inline-style gradient thumbnail (use rgba values, not dynamic Tailwind classes). Deterministic color from URL hash. `formatTimestamp` helper for relative times. Active: `border-indigo-500/35 bg-indigo-500/15`.

- [ ] **Step 3: Update TagBadge.tsx**

Rounded-lg chip with inline border/background from tag color. Import `X` from lucide-react for remove button. Add `hover:scale-[1.04]` transition.

- [ ] **Step 4: Rewrite CaptureViewer.tsx**

Major rewrite — viewer header with action icons, browser chrome screenshot card, bottom sub-tabs with icons (`Image`, `Globe`, `Code`, `FileText`, `Info`, `Fingerprint`, `Sparkles`, `Tag`, `Plus`), extract entities glow button, styled tag bar with add-tag dashed button, capture position indicator with keyboard hints. Add keyboard navigation (arrow keys) via useEffect.

- [ ] **Step 5: Verify and commit**

```bash
git add src/renderer/components/captures/ src/renderer/components/tags/TagBadge.tsx
git commit -m "feat: redesign captures workspace with rich sidebar, browser chrome viewer, and bottom tabs"
```

---

## Task 5: Dashboard Redesign

**Files:**
- Modify: `src/renderer/components/dashboard/Dashboard.tsx`

### Changes from design

- Two-column case card grid (`grid-cols-2`) replacing vertical list
- 4-stat cards with icons (Active Cases, Total Captures, Entities Found, Storage Used)
- Case cards with per-case stat pills, tag dots, recording badge
- Search input + Sort button above cards
- "View all cases" link
- Container widens to `max-w-6xl`
- Extension status condensed (moves to TopBar)

### Step-by-step

- [ ] **Step 1: Rewrite Dashboard.tsx**

Import icons: `FolderOpen`, `Camera`, `Fingerprint`, `HardDrive`, `Search`, `ArrowUpDown`, `Clock`, `ArrowRight`, `Plus`. Stats grid `grid-cols-4` with icon boxes. Case cards in `grid-cols-2` with `neu-card rounded-2xl`. Add search state with filter. Keep rename/delete via card kebab menu (preserve `data-testid` attributes for E2E tests). Update all colors per migration table.

- [ ] **Step 2: Verify E2E tests still pass**

```bash
pnpm test:e2e
```

Dashboard E2E tests (`e2e/cases.spec.ts`) reference `data-testid="new-case-btn"`, `case-card`, `case-card-menu-btn`, `case-card-rename-btn`, `case-card-delete-btn`, `case-rename-input`. These MUST be preserved.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/dashboard/Dashboard.tsx
git commit -m "feat: redesign dashboard with rich case cards, stats, and search"
```

---

## Task 6: Case Overview — Two-Column Layout

**Files:**
- Modify: `src/renderer/components/cases/CaseOverview.tsx`

### Changes from design

- Two-column layout: main content + right sidebar (w-80)
- Stat cards with icon boxes and trend badges
- Activity timeline with 14-day bar chart
- Right sidebar: Quick Actions (Analyze, Export), Top Domains, Investigation Health panel
- Edit indicators with pencil icon on hover

### Step-by-step

- [ ] **Step 1: Rewrite CaseOverview.tsx**

Import icons: `Camera`, `Globe`, `Fingerprint`, `Sparkles`, `FileOutput`, `Zap`, `ChevronRight`, `Pencil`. Two-column flex layout. Stats in `neu-card rounded-2xl` with icon boxes. Timeline with date-labeled bars. Sidebar cards. Apply color migration.

- [ ] **Step 2: Verify and commit**

```bash
git add src/renderer/components/cases/CaseOverview.tsx
git commit -m "feat: redesign case overview with two-column layout and investigation health"
```

---

## Task 7: Entities Tab — Rich Filters & Visual Bars

**Files:**
- Modify: `src/renderer/components/cases/CaseEntities.tsx`

### Changes from design

- Replace native `<select>` filters with colored filter chips + segmented source buttons
- Add search input
- Summary strip with entity count and color legend
- Table: colored type badges with dots, visual confidence bars, source badges with icons, expand chevrons
- Rich expanded capture cards (horizontal scroll)
- Export + Extract All buttons

### Step-by-step

- [ ] **Step 1: Rewrite CaseEntities.tsx**

Import icons: `Search`, `ArrowUpDown`, `ArrowDown`, `Sparkles`, `ChevronRight`, `ChevronDown`, `Layers`, `Globe`, `Download`, `Fingerprint`. Entity type color map (person=amber, email=green, domain=pink, crypto=yellow, org=sky, ip=red). Filter chips as buttons with colored dots. Confidence visual bars. Apply color migration.

- [ ] **Step 2: Verify and commit**

```bash
git add src/renderer/components/cases/CaseEntities.tsx
git commit -m "feat: redesign entities tab with filter chips, visual bars, and rich cards"
```

---

## Task 8: Analysis Tab — Color Migration

**Files:**
- Modify: `src/renderer/components/analysis/CaseAnalysis.tsx`
- Modify: `src/renderer/components/analysis/InsightsPanel.tsx`
- Modify: `src/renderer/components/analysis/EntityTimeline.tsx`
- Modify: `src/renderer/components/analysis/EntityGraph.tsx`

### Changes from design

Primarily color migration — the Analysis tab structure stays similar. Key changes:
- Analyze button: amber → indigo with shadow
- InsightsPanel: amber-themed summary card → indigo-themed
- EntityTimeline: amber bars → indigo bars
- EntityGraph: existing TYPE_COLORS stay (they're entity-type-specific)
- All card containers: `border-neutral-800 bg-neutral-900` → `neu-card rounded-2xl`

### Step-by-step

- [ ] **Step 1: Apply color migration to all 4 files**

Mechanical find-and-replace using the global migration table. Key specific swaps:
- `bg-amber-600` → `bg-indigo-600` (analyze button)
- `border-amber-900/50 bg-amber-950/20` → `border-indigo-500/20 bg-indigo-500/10` (summary card)
- `text-amber-500` → `text-indigo-400` (summary heading)
- `bg-amber-600/40` → `bg-indigo-500/15` (timeline bars)
- `bg-amber-600/20 text-amber-500` → `bg-indigo-500/20 text-indigo-400` (suggestion badges)

- [ ] **Step 2: Verify and commit**

```bash
git add src/renderer/components/analysis/
git commit -m "feat: migrate analysis tab to OLED dark theme with indigo accents"
```

---

## Task 9: Selectors Tab — Regex Highlighting & Test Preview

**Files:**
- Modify: `src/renderer/components/selectors/SelectorsOverview.tsx`

### Changes from design

- Create Selector: collapsible card with grid layout, inline regex toggle button
- Selector table: custom toggle switches, regex syntax highlighting, filter column
- Live test preview panel with highlighted matches
- Per-row action buttons (test, edit, delete)
- Cross-filter bottom bar

### Step-by-step

- [ ] **Step 1: Rewrite SelectorsOverview.tsx**

Import icons: `Plus`, `Search`, `FlaskConical`, `Filter`, `ArrowUpDown`, `ChevronUp`, `Pencil`, `Trash2`, `X`, `XCircle`, `Crosshair`, `Globe`, `Layers`. Major structural rewrite with collapsible create card, rich table, toggle switches, and filter bar. Apply color migration.

- [ ] **Step 2: Verify and commit**

```bash
git add src/renderer/components/selectors/SelectorsOverview.tsx
git commit -m "feat: redesign selectors tab with regex highlighting and test preview"
```

---

## Task 10: Settings — Sidebar Nav & Appearance Page

**Files:**
- Modify: `src/renderer/components/settings/SettingsView.tsx`
- Modify: `src/renderer/components/settings/AIConfig.tsx`
- Modify: `src/renderer/components/settings/EntityExtractionConfig.tsx`
- Modify: `src/renderer/components/settings/CapturePreferences.tsx`
- Modify: `src/renderer/components/settings/StorageConfig.tsx`
- Modify: `src/renderer/components/settings/About.tsx`
- Create: `src/renderer/components/settings/AppearanceConfig.tsx`

### Changes from design

- SettingsView gets left sidebar nav (200px) with tabs: AI, Entities, Capture, Storage, Appearance, About
- New AppearanceConfig component: theme selector (Light/Dark/System), reduce motion toggle
- All sub-components: apply color migration
- Footer with Cancel/Save buttons (if changing from live-save to explicit save)

### Step-by-step

- [ ] **Step 1: Create AppearanceConfig.tsx**

Theme selector with 3 visual cards (Light/Dark/System), reduce motion toggle. For now, dark-only — the toggle is a placeholder for future light mode support.

- [ ] **Step 2: Rewrite SettingsView.tsx with sidebar nav**

Import icons: `User`, `Briefcase`, `Palette`, `Bell`, `Key`, `Info`. Left sidebar with tab buttons. Content area renders the active settings sub-component. Apply color migration.

- [ ] **Step 3: Apply color migration to all sub-components**

Mechanical color swaps in AIConfig, EntityExtractionConfig, CapturePreferences, StorageConfig, About. Key: `border-neutral-800 bg-neutral-900 p-5` → `neu-card rounded-2xl p-5`.

- [ ] **Step 4: Verify and commit**

```bash
git add src/renderer/components/settings/
git commit -m "feat: redesign settings with sidebar nav and appearance page"
```

---

## Task 11: New Case Wizard

**Files:**
- Modify: `src/renderer/stores/appStore.ts` — add `'new-case-wizard'` to `AppMode`
- Modify: `src/renderer/components/layout/MainContent.tsx` — render wizard
- Create: `src/renderer/components/cases/NewCaseWizard.tsx`
- Modify: `src/renderer/components/dashboard/Dashboard.tsx` — update "New Case" button to navigate to wizard
- Modify: `src/main/services/database.ts` — add `type` column to cases table
- Modify: `src/shared/types.ts` — add `type` field to Case type

### Changes from design

Multi-step wizard (3 steps) replacing CreateCaseDialog:
1. Investigation details: name, description, type (Crypto/Malware/Fraud/Custom), initial selectors
2. Configure browser extension (placeholder)
3. Start capturing (placeholder)

### Step-by-step

- [ ] **Step 1: Add `type` column to cases schema**

In `src/main/services/database.ts`, add migration for `ALTER TABLE cases ADD COLUMN type TEXT DEFAULT 'custom'`. Update `user_version` pragma.

- [ ] **Step 2: Update Case type**

In `src/shared/types.ts`, add `type?: 'crypto' | 'malware' | 'fraud' | 'custom'` to the `Case` interface.

- [ ] **Step 3: Add app mode**

In `src/renderer/stores/appStore.ts`:
- Add `'new-case-wizard'` to `AppMode` union
- Add `goToNewCaseWizard: () => void` action

- [ ] **Step 4: Update MainContent.tsx**

Add case for `appMode === 'new-case-wizard'` rendering `<NewCaseWizard />`.

- [ ] **Step 5: Create NewCaseWizard.tsx**

Full wizard component with step state, type selector cards, selector checkbox chips, progress indicator. Import icons: `FolderPlus`, `Type`, `AlignLeft`, `Tag`, `Bitcoin`, `Bug`, `ShieldAlert`, `Settings2`, `Crosshair`, `Check`, `Info`, `ArrowRight`, `ArrowLeft`.

- [ ] **Step 6: Update Dashboard "New Case" button**

Change `onClick` to call `goToNewCaseWizard()` instead of `setShowCreate(true)`.

- [ ] **Step 7: Run tests**

```bash
pnpm test
pnpm test:e2e
```

E2E test for case creation (`data-testid="new-case-btn"`) will need to be updated since the flow changes from modal to full-page wizard.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/database.ts src/shared/types.ts src/renderer/stores/appStore.ts src/renderer/components/layout/MainContent.tsx src/renderer/components/cases/NewCaseWizard.tsx src/renderer/components/dashboard/Dashboard.tsx
git commit -m "feat: add multi-step new case wizard with investigation type selection"
```

---

## Task 12: Extension Popup Redesign

**Files:**
- Modify: `extension/src/popup/popup.tsx`
- Modify: `extension/src/popup/popup.html`

### Changes from design

- Card-based layout with header, status card, stats grid, entity highlights
- OLED dark colors: `#000000` body, `#111827` cards, indigo-600 primary
- Entity highlights section showing detected entity types with counts
- Glow effects on buttons
- Keep all 3 states (disconnected, recording, connected-idle)

### Step-by-step

- [ ] **Step 1: Update popup.html**

Change body background to `#000000`, add font imports (same @fontsource packages — but note extension uses separate build, may need own font loading strategy or inline CSS).

- [ ] **Step 2: Rewrite popup.tsx styles**

Replace all inline `style={{}}` objects with the new OLED dark color system. Change amber (`#f59e0b`) to indigo (`#4f46e5`). Add entity highlights section to recording state (mock data for now — real entity data would need extension API changes).

- [ ] **Step 3: Verify extension builds**

```bash
pnpm build:extension
```

- [ ] **Step 4: Commit**

```bash
git add extension/src/popup/
git commit -m "feat: redesign extension popup with OLED dark theme and entity highlights"
```

---

## Task 13: Extension Sidebar Redesign

**Files:**
- Modify: `extension/src/sidebar.ts`

### Changes from design

- Multi-purpose panel: Active Selectors, Detected Entities, Live Capture sections
- OLED dark colors: `#000000` bg, `#111318` cards, indigo accents
- Entity section with type grouping, confidence badges
- Footer with "Capture Now" button
- Slide-in animation

### Step-by-step

- [ ] **Step 1: Update STYLES constant in sidebar.ts**

Replace all color values in the CSS string: `#1a1a1a` → `#000000`, `#333` → `rgba(255,255,255,0.08)`, `#f59e0b` → `#4f46e5`, etc. Add entity-specific colors (person=amber, email=green, domain=pink, crypto=yellow).

- [ ] **Step 2: Update HTML generation functions**

Update `renderSidebar()` and related functions with new section structure. Add entity section HTML (initially empty — populated when entity data is available).

- [ ] **Step 3: Verify extension builds**

```bash
pnpm build:extension
```

- [ ] **Step 4: Commit**

```bash
git add extension/src/sidebar.ts
git commit -m "feat: redesign extension sidebar with OLED dark theme and entity sections"
```

---

## Task 14: Cleanup — Tests, Dead Code, BrowserWindow

**Files:**
- Modify: `src/main/index.ts` — update `backgroundColor` to `#000000`
- Modify: `e2e/cases.spec.ts` — remove workspace header rename test
- Modify: `src/renderer/components/cases/CreateCaseDialog.tsx` — keep for backwards compat or remove
- Modify: `src/renderer/components/cases/CaseSwitcher.tsx` — dead code (removed from TopBar)
- Modify: `src/renderer/components/selectors/SelectorFilterBar.tsx` — dead code (integrated into CaptureList)
- Modify: `src/renderer/components/export/ExportDialog.tsx` — apply color migration

### Step-by-step

- [ ] **Step 1: Update BrowserWindow backgroundColor**

In `src/main/index.ts`, change `backgroundColor: '#0a0a0a'` to `backgroundColor: '#000000'`.

- [ ] **Step 2: Update E2E test**

In `e2e/cases.spec.ts`, remove the test "can rename a case from workspace header" (lines 92-112) since the workspace header is removed. Update the case creation E2E test if the flow changed to the wizard.

- [ ] **Step 3: Apply color migration to remaining components**

Update `CreateCaseDialog.tsx`, `ExportDialog.tsx`, `TagManager.tsx`, and any other components not yet migrated. Apply the global color migration table.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
pnpm test:e2e
pnpm lint
```

- [ ] **Step 5: Clean up dead code**

Remove or mark as unused: `CaseSwitcher.tsx`, `SelectorFilterBar.tsx` (if fully replaced). Only remove if no other imports reference them.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: cleanup tests, dead code, and remaining color migration"
```

---

## Summary of All New/Modified Files

### New Files (3)
| File | Task |
|------|------|
| `src/renderer/components/settings/AppearanceConfig.tsx` | 10 |
| `src/renderer/components/cases/NewCaseWizard.tsx` | 11 |
| `.superdesign/` (init + drafts) | Setup |

### Modified Files (30+)
| File | Tasks |
|------|-------|
| `package.json` | 1 |
| `src/renderer/styles/globals.css` | 1 |
| `src/renderer/App.tsx` | 1 |
| `src/renderer/components/layout/TopBar.tsx` | 2 |
| `src/renderer/components/layout/MainContent.tsx` | 2, 11 |
| `src/renderer/components/status/ConnectionStatus.tsx` | 2 |
| `src/renderer/components/status/SessionControls.tsx` | 2 |
| `src/renderer/components/search/SearchBar.tsx` | 2 |
| `src/renderer/components/cases/CaseWorkspace.tsx` | 3 |
| `src/renderer/components/captures/CaptureList.tsx` | 4 |
| `src/renderer/components/captures/CaptureItem.tsx` | 4 |
| `src/renderer/components/captures/CaptureViewer.tsx` | 4 |
| `src/renderer/components/tags/TagBadge.tsx` | 4 |
| `src/renderer/components/dashboard/Dashboard.tsx` | 5, 11 |
| `src/renderer/components/cases/CaseOverview.tsx` | 6 |
| `src/renderer/components/cases/CaseEntities.tsx` | 7 |
| `src/renderer/components/analysis/CaseAnalysis.tsx` | 8 |
| `src/renderer/components/analysis/InsightsPanel.tsx` | 8 |
| `src/renderer/components/analysis/EntityTimeline.tsx` | 8 |
| `src/renderer/components/analysis/EntityGraph.tsx` | 8 |
| `src/renderer/components/selectors/SelectorsOverview.tsx` | 9 |
| `src/renderer/components/settings/SettingsView.tsx` | 10 |
| `src/renderer/components/settings/AIConfig.tsx` | 10 |
| `src/renderer/components/settings/EntityExtractionConfig.tsx` | 10 |
| `src/renderer/components/settings/CapturePreferences.tsx` | 10 |
| `src/renderer/components/settings/StorageConfig.tsx` | 10 |
| `src/renderer/components/settings/About.tsx` | 10 |
| `src/renderer/stores/appStore.ts` | 11 |
| `src/shared/types.ts` | 11 |
| `src/main/services/database.ts` | 11 |
| `src/main/index.ts` | 14 |
| `e2e/cases.spec.ts` | 14 |
| `extension/src/popup/popup.tsx` | 12 |
| `extension/src/popup/popup.html` | 12 |
| `extension/src/sidebar.ts` | 13 |
| `src/renderer/components/export/ExportDialog.tsx` | 14 |
| `src/renderer/components/cases/CreateCaseDialog.tsx` | 14 |
| `src/renderer/components/tags/TagManager.tsx` | 14 |
