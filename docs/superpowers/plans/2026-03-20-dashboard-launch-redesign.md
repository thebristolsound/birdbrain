# Dashboard Launch Screen & Header Bar Redesign

**SuperDesign Draft**: Birdbrain — Launch (HeaderBar + Linked CTAs)
**Project ID**: `0ee09075-9ca1-4004-a3e4-701a561e82bf`
**Draft ID**: `e782db00-7ef7-455d-ac7f-8af0f7e926f4`
**Created**: 2026-03-20

## Summary

Redesign the Dashboard and TopBar to match the SuperDesign "Launch" draft. The design transforms the dashboard from a utilitarian case-list view into a polished welcome/launch screen with hero section, rich case cards, quick-start guide, extension install banner, and footer. The TopBar gets a simplified layout with notification/settings icons and user avatar.

## Design Analysis

### What changes from current UI

**TopBar** (current → design):
- Height stays at h-14 (56px)
- Remove: breadcrumb navigation (Investigations > Case Name), SearchBar, SessionControls, ConnectionStatus, recording badge
- Keep: Logo icon + "Birdbrain" text, Settings button
- Add: Version badge ("v2.0"), notification bell button, vertical divider, user avatar with initials + name
- The design TopBar is a minimal header — search/session/connection controls are removed from the dashboard view (they already exist in CaseWorkspace via TopBar's conditional rendering, but currently show on dashboard too)
- **Key decision**: The design TopBar is dashboard-specific. In case-workspace mode, the TopBar should retain its current breadcrumb + search + session controls. We'll conditionally render different right-side content based on `appMode`.

**Dashboard** (current → design):
- Remove: simple header row, extension status text, stats grid (Active Cases/Total Captures/Entities/Storage), search+sort bar, 2-column case card grid with kebab menus
- Add: Hero section with animated logo, welcome title with shimmer effect, two CTAs (Start New Investigation, Open Recent Case), keyboard shortcuts display
- Add: Recent Cases section — 4-column card grid with icon, status badge (Recording/Active/Paused), title, description, stats (captures/entities/domains), tags, timestamp, "New Investigation" dashed card
- Add: Quick Start guide — 4 numbered step cards (Add Selectors, Capture Pages, Analyze Entities, Export Reports) with connecting lines
- Add: Extension Install banner — CTA card with "Install Extension" button and "Learn More" link
- Add: Footer — logo, version, links (Documentation, Changelog, GitHub)
- Keep: Case card rename/delete functionality (integrate into redesigned cards)

### CSS additions needed

New animations and styles for globals.css:
- `@keyframes fadeUp` — slide up entrance
- `@keyframes scaleIn` — scale entrance
- `@keyframes float` — gentle floating logo
- `@keyframes shimmer` — text gradient animation
- `@keyframes pulse-ring` — logo pulse ring
- `@keyframes glow-pulse` — logo glow (dark mode)
- `.shimmer-text` — gradient text with shimmer
- `.logo-pulse` — pulsing logo ring + float
- `.step-connector` — gradient line between step numbers
- `.grid-bg` — subtle grid background pattern
- `.new-case-card` — dashed border card for "New Investigation"
- Animation delay classes (`.d1` through `.d9`)
- `.anim-up`, `.anim-scale` — entrance animation variants

## File Structure

```
src/renderer/styles/globals.css                          — MODIFY (add new animations/CSS classes)
src/renderer/components/layout/TopBar.tsx                 — MODIFY (conditional dashboard vs workspace rendering)
src/renderer/components/dashboard/Dashboard.tsx           — REWRITE (complete redesign)
src/renderer/components/dashboard/HeroSection.tsx         — NEW (logo + welcome + CTAs)
src/renderer/components/dashboard/RecentCases.tsx         — NEW (case cards grid)
src/renderer/components/dashboard/CaseCard.tsx            — NEW (individual case card with rich layout)
src/renderer/components/dashboard/QuickStartGuide.tsx     — NEW (4-step process cards)
src/renderer/components/dashboard/ExtensionBanner.tsx     — NEW (install extension CTA)
src/renderer/components/dashboard/DashboardFooter.tsx     — NEW (footer with links)
```

## Tasks

### Task 1: Add CSS animations and utility classes to globals.css

**File**: `src/renderer/styles/globals.css`
**Action**: Add new keyframes and CSS classes after existing styles.

Add these keyframe animations:
```css
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
  0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.4), 0 0 60px rgba(99,102,241,0.15); }
  50% { box-shadow: 0 0 30px rgba(99,102,241,0.6), 0 0 80px rgba(99,102,241,0.25); }
}
```

Add these utility classes:
```css
.anim-up { animation: fadeUp 0.6s ease-out forwards; opacity: 0; }
.anim-scale { animation: scaleIn 0.5s ease-out forwards; opacity: 0; }

/* Animation delay classes */
.d1 { animation-delay: 0.1s; }
.d2 { animation-delay: 0.2s; }
.d3 { animation-delay: 0.3s; }
.d4 { animation-delay: 0.4s; }
.d5 { animation-delay: 0.5s; }
.d6 { animation-delay: 0.6s; }
.d7 { animation-delay: 0.7s; }
.d8 { animation-delay: 0.8s; }
.d9 { animation-delay: 0.9s; }

.shimmer-text {
  background: linear-gradient(90deg, #818cf8 0%, #c7d2fe 25%, #818cf8 50%, #a5b4fc 75%, #818cf8 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: shimmer 4s linear infinite;
}

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

.step-connector {
  height: 2px;
  background: linear-gradient(90deg, rgba(99,102,241,0.3), rgba(99,102,241,0.1));
}

.grid-bg {
  background-image:
    radial-gradient(circle at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 50%),
    linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 100% 100%, 48px 48px, 48px 48px;
}

.new-case-card {
  border-color: rgba(99,102,241,0.3);
  background: rgba(99,102,241,0.05);
}
.new-case-card:hover {
  border-color: rgba(99,102,241,0.5);
  background: rgba(99,102,241,0.1);
}

.case-tag { transition: all 0.15s ease; }
```

**Dependencies**: None
**Verify**: `pnpm build` passes

---

### Task 2: Create HeroSection component

**File**: `src/renderer/components/dashboard/HeroSection.tsx` (NEW)
**Action**: Create the hero section with animated logo, welcome title, CTAs, and keyboard shortcuts.

Props:
```typescript
interface HeroSectionProps {
  onNewInvestigation: () => void
  onOpenRecent: () => void
}
```

Structure:
- Centered container (`max-w-3xl mx-auto text-center`)
- Logo mark: 64px indigo rounded-2xl with `Radar` icon from lucide-react, `.logo-pulse` class
- Title: "Welcome to" + `<span className="shimmer-text">Birdbrain</span>` in `font-display font-extrabold text-4xl`
- Subtitle: description text in `text-base text-slate-400`
- Two CTA buttons:
  - "Start New Investigation" — indigo primary button with `PlusCircle` icon, calls `onNewInvestigation`
  - "Open Recent Case" — outlined secondary button with `FolderOpen` icon, calls `onOpenRecent` (scrolls to recent cases section)
- Keyboard shortcuts: two `<kbd>` pill elements showing `Ctrl+N` (create) and `Ctrl+K` (search)
- Use `.anim-scale`, `.anim-up`, `.anim-in` classes with delay classes for staggered entrance

Use lucide-react icons: `Radar`, `PlusCircle`, `FolderOpen`

**Dependencies**: Task 1 (CSS classes)
**Verify**: `pnpm build` passes

---

### Task 3: Create CaseCard component

**File**: `src/renderer/components/dashboard/CaseCard.tsx` (NEW)
**Action**: Create a rich case card matching the design.

Props:
```typescript
interface CaseCardProps {
  caseData: Case
  isRecording: boolean
  captureCount: number
  entityCount: number
  onClick: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  animDelay?: string // e.g. "d5", "d6"
}
```

Structure:
- Container: `neu-card rounded-2xl p-5 cursor-pointer group`
- Top row: case icon (10x10 rounded-xl with colored background based on case type) + status badge
  - Status badge: "Recording" (red pulse dot, red bg) if `isRecording`, otherwise "Active" (emerald dot, emerald bg)
- Title: `font-display font-bold text-sm` with hover color change to indigo
- Description: `text-[11px] text-slate-500` (truncated)
- Stats row: captures count (Camera icon), entities count (Fingerprint icon), domains count (Globe icon)
  - Stats use `text-[11px] font-bold text-slate-300` with `text-xs text-slate-600` icons
- Tags row: colored tag pills from case type (use `case-tag` class)
- Footer: "Updated X ago" timestamp + arrow-up-right icon on hover
- Context menu (three-dot): on hover, shows rename/delete dropdown (preserve existing rename/delete logic from current Dashboard)

Case type → icon/color mapping:
- `crypto` → Bitcoin icon, amber bg
- `malware` → ShieldAlert icon, sky bg
- `fraud` → Users icon, pink bg
- default → FolderOpen icon, indigo bg

Use lucide-react icons: `Camera`, `Fingerprint`, `Globe`, `ArrowUpRight`, `Bitcoin`, `ShieldAlert`, `Users`, `FolderOpen`, `MoreVertical`

**Dependencies**: Task 1 (CSS classes)
**Verify**: `pnpm build` passes

---

### Task 4: Create RecentCases component

**File**: `src/renderer/components/dashboard/RecentCases.tsx` (NEW)
**Action**: Create the recent cases section with grid layout and "New Investigation" card.

Props:
```typescript
interface RecentCasesProps {
  cases: Case[]
  activeCaseId: string | null
  sessionActive: boolean
  onSelectCase: (id: string) => void
  onNewCase: () => void
  onRenameCase: (id: string, name: string) => void
  onDeleteCase: (id: string) => void
}
```

Structure:
- Section container (`max-w-5xl mx-auto`)
- Header row: "Recent Cases" title + count badge ("X active") + "View All" link (no-op for now)
- 4-column grid (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5`)
- Map first 3 cases to `CaseCard` components with staggered animation delays
- Last grid slot: "New Investigation" dashed card
  - Uses `.new-case-card` class, dashed border, centered content
  - Plus icon in rounded-2xl container with rotate-90 hover animation
  - "New Investigation" title + "Start a fresh case with guided setup" subtitle
  - Calls `onNewCase` on click

Use lucide-react icons: `Plus`, `ArrowRight`

**Dependencies**: Task 1, Task 3
**Verify**: `pnpm build` passes

---

### Task 5: Create QuickStartGuide component

**File**: `src/renderer/components/dashboard/QuickStartGuide.tsx` (NEW)
**Action**: Create the 4-step quick-start guide section.

Structure:
- Section container (`max-w-5xl mx-auto`)
- Header: compass icon in indigo rounded-lg + "Quick Start" title + horizontal line divider
- 4-column grid of step cards, each containing:
  - Step number badge: indigo rounded-xl with number + step connector line
  - Feature icon: colored rounded-xl background (emerald for Step 1, amber for Step 2, sky for Step 3, indigo for Step 4)
  - Step 4 has a check icon instead of connector line
  - Title: `font-display font-bold text-sm`
  - Description: `text-[11px] text-slate-500`

Steps data:
1. "Add Selectors" — Crosshair icon, emerald — "Define regex patterns or entity types..."
2. "Capture Pages" — Camera icon, amber — "Browse the web with our extension..."
3. "Analyze Entities" — Brain icon, sky — "AI-powered entity extraction..."
4. "Export Reports" — FileOutput icon, indigo — "Generate structured intelligence reports..."

Cards use `neu-card rounded-2xl p-5` and entrance animation classes.

Use lucide-react icons: `Compass`, `Crosshair`, `Camera`, `Brain`, `FileOutput`, `Check`

**Dependencies**: Task 1 (CSS classes)
**Verify**: `pnpm build` passes

---

### Task 6: Create ExtensionBanner component

**File**: `src/renderer/components/dashboard/ExtensionBanner.tsx` (NEW)
**Action**: Create the extension install banner.

Props:
```typescript
interface ExtensionBannerProps {
  connected: boolean
}
```

Structure:
- `neu-card rounded-2xl p-6` container, flex row with items-center justify-between
- Left: puzzle icon in indigo rounded-2xl + text block (title + description)
- Right: "Install Extension" primary button (indigo) + "Learn More" text link
- If `connected` is true, show different text: "Browser Extension Connected" with green indicator
- Use `.anim-up` with late delay class

Use lucide-react icons: `Puzzle`, `Download`

**Dependencies**: Task 1 (CSS classes)
**Verify**: `pnpm build` passes

---

### Task 7: Create DashboardFooter component

**File**: `src/renderer/components/dashboard/DashboardFooter.tsx` (NEW)
**Action**: Create the footer with version info and links.

Structure:
- `border-t border-white/[0.06] px-8 py-6` container
- Left: small Radar icon in indigo square + "Birdbrain v2.0.0 — Open-Source Intelligence Platform"
- Right: three links — "Documentation", "Changelog", "GitHub" (with GitHub icon)
- Links are `text-[11px] text-slate-600 hover:text-indigo-400` — for now they are no-op anchors
- Use `.anim-in` with late delay

Use lucide-react icons: `Radar`, `Github`

**Dependencies**: Task 1 (CSS classes)
**Verify**: `pnpm build` passes

---

### Task 8: Rewrite Dashboard to compose new components

**File**: `src/renderer/components/dashboard/Dashboard.tsx` (REWRITE)
**Action**: Replace the current Dashboard with the new launch screen composed from the sub-components.

The new Dashboard:
- Wraps everything in `<div className="grid-bg min-h-full">` for the subtle grid background
- Composes: `HeroSection` → `RecentCases` → `QuickStartGuide` → `ExtensionBanner` → `DashboardFooter`
- Passes appropriate props from hooks/store:
  - `useCases()` for cases data + `updateCase` + `deleteCase`
  - `useAppStore()` for `selectCase`, `goToNewCaseWizard`, `connectedToExtension`, `activeCaseId`, `sessionActive`
- The "Open Recent Case" CTA scrolls to the recent cases section using a ref
- `data-testid="dashboard"` must be preserved on the root element

Preserve existing functionality:
- Case rename (inline editing) — delegated to CaseCard via `onRename`
- Case delete (confirm dialog) — delegated to CaseCard via `onDelete`
- Case selection → `selectCase(id)` navigates to case workspace

**Dependencies**: Tasks 2, 3, 4, 5, 6, 7
**Verify**: `pnpm build` passes

---

### Task 9: Update MainContent for grid-bg dashboard wrapper

**File**: `src/renderer/components/layout/MainContent.tsx` (MODIFY)
**Action**: Remove the `<div className="p-6">` wrapper around `<Dashboard />` since Dashboard now handles its own padding/layout via the grid-bg full-bleed design.

Change:
```tsx
{appMode === 'dashboard' && (
  <div className="p-6">
    <Dashboard />
  </div>
)}
```
To:
```tsx
{appMode === 'dashboard' && <Dashboard />}
```

**Dependencies**: Task 8
**Verify**: `pnpm build` passes

---

### Task 10: Update TopBar with conditional dashboard rendering

**File**: `src/renderer/components/layout/TopBar.tsx` (MODIFY)
**Action**: When `appMode === 'dashboard'`, render a simplified right-side section (notifications, settings, user avatar). When in `case-workspace`, keep the current breadcrumb + search + session controls.

Changes:
- In dashboard mode, right side shows:
  - Bell icon button (`Bell` from lucide-react) — no-op for now
  - Settings icon button (existing)
  - Vertical divider (`w-px h-5 bg-slate-800`)
  - User avatar (32px indigo circle with "JA" initials) + name "J. Analyst" — hardcoded placeholder for now
- In case-workspace mode, keep the existing layout (breadcrumb, search, session controls, recording badge, connection status, settings)
- Add version badge next to "Birdbrain" text: `<span className="ml-1 rounded bg-slate-900 border border-slate-800 px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-500">v2.0</span>`
- Version badge shows in all modes

Use lucide-react icons: `Bell` (add to imports)

**Dependencies**: None
**Verify**: `pnpm build` passes

---

## Task Summary

| # | Task | File(s) | Action | Dependencies |
|---|------|---------|--------|-------------|
| 1 | CSS animations & utilities | globals.css | Modify | None |
| 2 | HeroSection component | HeroSection.tsx | New | 1 |
| 3 | CaseCard component | CaseCard.tsx | New | 1 |
| 4 | RecentCases component | RecentCases.tsx | New | 1, 3 |
| 5 | QuickStartGuide component | QuickStartGuide.tsx | New | 1 |
| 6 | ExtensionBanner component | ExtensionBanner.tsx | New | 1 |
| 7 | DashboardFooter component | DashboardFooter.tsx | New | 1 |
| 8 | Dashboard rewrite | Dashboard.tsx | Rewrite | 2, 3, 4, 5, 6, 7 |
| 9 | MainContent update | MainContent.tsx | Modify | 8 |
| 10 | TopBar conditional rendering | TopBar.tsx | Modify | None |

## Parallelization Strategy

- **Batch 1** (parallel): Tasks 1, 10 — no dependencies on each other
- **Batch 2** (parallel): Tasks 2, 3, 5, 6, 7 — all depend only on Task 1
- **Batch 3**: Task 4 — depends on Task 3
- **Batch 4**: Task 8 — depends on all component tasks
- **Batch 5**: Task 9 — depends on Task 8

## Design Tokens Reference

Colors from the design (all already in globals.css @theme):
- Indigo: 300-700 range (primary accent)
- Slate: 100-900 range (text/surfaces)
- Amber, Emerald, Red, Sky, Pink: accent colors for case types/status badges

Font families (already configured):
- `font-display` — Plus Jakarta Sans (headings, buttons)
- `font-body` — DM Sans (body text)
- `font-mono` — JetBrains Mono (version badges, keyboard shortcuts)
