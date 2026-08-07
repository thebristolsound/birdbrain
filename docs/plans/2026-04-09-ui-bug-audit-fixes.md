# UI Bug Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 confirmed UI bugs covering responsive layout, light-mode token hygiene, dead controls, a Tailwind class typo, invisible interaction affordances, a broken scroll container, and a fragile back-navigation.

**Architecture:** All changes are confined to the renderer layer — no IPC, no main process, no new routes. Each task is a surgical edit to one or two files with no new abstractions needed.

**Tech Stack:** React 19, Tailwind v4, TanStack Router, Electron renderer

---

## File Map

| File | Tasks |
|---|---|
| `src/renderer/components/dashboard/QuickStartGuide.tsx` | 1, 2 |
| `src/renderer/components/dashboard/CaseCard.tsx` | 2, 5 |
| `src/renderer/components/dashboard/ExtensionBanner.tsx` | 2, 3 |
| `src/renderer/components/dashboard/RecentCases.tsx` | 3 |
| `src/renderer/components/settings/About.tsx` | 3 |
| `src/renderer/components/layout/OnboardingWizard.tsx` | 4 |
| `src/renderer/components/cases/NewCaseWizard.tsx` | 4 |
| `src/renderer/components/search/SearchBar.tsx` | 5 |
| `src/renderer/routes/__root.tsx` | 6 |
| `src/renderer/routes/cases/$caseId/captures.tsx` | 7 |
| `src/renderer/components/layout/TopBar.tsx` | 7 |

---

### Task 1: Responsive grid in QuickStartGuide

**Problem:** `grid grid-cols-4` has no responsive breakpoints — collapses to unusably narrow cards on smaller desktop widths.

**Files:**
- Modify: `src/renderer/components/dashboard/QuickStartGuide.tsx:56`

- [ ] **Step 1: Apply responsive grid classes**

In [QuickStartGuide.tsx:56](src/renderer/components/dashboard/QuickStartGuide.tsx#L56), change:

```tsx
<div className="grid grid-cols-4 gap-5">
```

to:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
pnpm lint
```

Expected: no errors in `QuickStartGuide.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/dashboard/QuickStartGuide.tsx
git commit -m "fix: make QuickStartGuide grid responsive with sm/lg breakpoints"
```

---

### Task 2: Replace dark-only `*-950` icon backgrounds with transparent-tinted equivalents

**Problem:** `bg-amber-950/50`, `bg-sky-950/50`, `bg-emerald-950/50`, `bg-pink-950/50` are dark-only variants that render as near-black backgrounds in light mode. The correct pattern (already used by the TopBar REC badge and the default case icon) is transparent tints: `bg-{color}-500/10 border border-{color}-500/20`, which adapt correctly in both modes.

Note: the **status badges** (Recording, Active) and the **ExtensionBanner connected state** also use `*-950` variants and need the same treatment. These are status/severity indicators — use the transparent-tint pattern to stay consistent with `TopBar.tsx:95-98`.

**Files:**
- Modify: `src/renderer/components/dashboard/QuickStartGuide.tsx:3-39`
- Modify: `src/renderer/components/dashboard/CaseCard.tsx:16-33` and `:112-122`
- Modify: `src/renderer/components/dashboard/ExtensionBanner.tsx:21-38`

- [ ] **Step 1: Fix QuickStartGuide step icon backgrounds**

In `QuickStartGuide.tsx`, replace the `steps` array (lines 3–39) so the three dark-specific entries use transparent tints:

```tsx
const steps = [
  {
    number: 1,
    icon: Crosshair,
    bg: 'bg-emerald-500/10 border border-emerald-500/20',
    iconColor: 'text-emerald-500',
    title: 'Add Selectors',
    description:
      'Define regex patterns or entity types to automatically extract from captured pages.'
  },
  {
    number: 2,
    icon: Camera,
    bg: 'bg-amber-500/10 border border-amber-500/20',
    iconColor: 'text-amber-500',
    title: 'Capture Pages',
    description:
      'Browse the web with our extension. Screenshots, source code, and metadata are saved automatically.'
  },
  {
    number: 3,
    icon: Tags,
    bg: 'bg-sky-500/10 border border-sky-500/20',
    iconColor: 'text-sky-500',
    title: 'Review & Tag',
    description:
      'Organize captures with tags. Selectors automatically match patterns across your evidence.'
  },
  {
    number: 4,
    icon: FileOutput,
    bg: 'bg-accent-subtle border border-accent/20',
    iconColor: 'text-accent',
    title: 'Export Reports',
    description:
      'Generate structured intelligence reports with capture timelines, screenshots, and audit trails.'
  }
]
```

- [ ] **Step 2: Fix CaseCard type icon backgrounds**

In `CaseCard.tsx`, replace the `CASE_ICONS` constant (lines 16–33):

```tsx
const CASE_ICONS: Record<string, { icon: typeof FolderOpen; bgClass: string; iconClass: string }> =
  {
    crypto: {
      icon: FolderOpen,
      bgClass: 'bg-amber-500/10 border border-amber-500/20',
      iconClass: 'text-amber-500'
    },
    malware: {
      icon: ShieldAlert,
      bgClass: 'bg-sky-500/10 border border-sky-500/20',
      iconClass: 'text-sky-500'
    },
    fraud: {
      icon: Users,
      bgClass: 'bg-pink-500/10 border border-pink-500/20',
      iconClass: 'text-pink-500'
    }
  }
```

- [ ] **Step 3: Fix CaseCard status badge backgrounds**

In `CaseCard.tsx`, replace the status badge section (lines 112–122):

```tsx
{isRecording ? (
  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
    <span className="text-[9px] font-bold text-red-500">Recording</span>
  </div>
) : isActive ? (
  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
    <span className="text-[9px] font-bold text-emerald-500">Active</span>
  </div>
) : null}
```

- [ ] **Step 4: Fix ExtensionBanner connected state backgrounds**

In `ExtensionBanner.tsx`, replace the connected branch's icon container and badge (lines 21–38). The full connected JSX block becomes:

```tsx
<>
  <div className="flex items-center gap-5">
    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/10">
      <CheckCircle className="h-6 w-6 text-emerald-500" />
    </div>
    <div>
      <h4 className="font-display font-bold text-sm text-text-primary mb-0.5">
        Browser Extension Connected
      </h4>
      <p className="text-[11px] text-text-muted leading-relaxed">
        Your extension is connected and ready to capture.
      </p>
    </div>
  </div>
  <div className="flex items-center gap-3">
    <span className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-display font-bold text-xs rounded-xl">
      <CheckCircle className="h-3.5 w-3.5" />
      Connected
    </span>
  </div>
</>
```

- [ ] **Step 5: Verify lint passes**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/dashboard/QuickStartGuide.tsx \
        src/renderer/components/dashboard/CaseCard.tsx \
        src/renderer/components/dashboard/ExtensionBanner.tsx
git commit -m "fix: replace dark-only *-950 icon backgrounds with transparent-tinted equivalents"
```

---

### Task 3: Remove dead controls; wire GitHub link

**Problem:** Three controls have no behavior — "View All" (no route target exists), "Learn More" (no docs URL), and the GitHub `<a>` (no `href`). The first two should be removed to eliminate false affordance. The GitHub link gets a real `href`.

**Files:**
- Modify: `src/renderer/components/dashboard/RecentCases.tsx:34-37`
- Modify: `src/renderer/components/dashboard/ExtensionBanner.tsx:63-65`
- Modify: `src/renderer/components/settings/About.tsx:11`

- [ ] **Step 1: Remove the View All button from RecentCases**

In `RecentCases.tsx`, the header row (lines 25–38) currently has a "View All" button with no handler. Remove it. The header `div` becomes:

```tsx
<div className="flex items-center justify-between mb-6">
  <div className="flex items-center gap-3">
    <h2 className="font-display font-bold text-lg tracking-tight text-text-primary">
      Recent Cases
    </h2>
    <span className="rounded-full border border-border-strong bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-text-muted">
      {cases.length} {cases.length === 1 ? 'case' : 'cases'}
    </span>
  </div>
</div>
```

Also remove the now-unused `ArrowRight` import from the top of the file.

- [ ] **Step 2: Remove the Learn More button from ExtensionBanner**

In `ExtensionBanner.tsx`, the disconnected-state button row (lines 55–65) currently has two buttons. Remove the "Learn More" button. The `div` becomes:

```tsx
<div className="flex items-center gap-3">
  <button
    onClick={handleOpenFolder}
    className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-display font-bold text-xs rounded-xl shadow-lg shadow-indigo-500/30 transition-all active:scale-[0.98]"
  >
    <FolderOpen className="h-3.5 w-3.5" />
    Install Extension
  </button>
</div>
```

- [ ] **Step 3: Wire the GitHub link in About**

In `About.tsx`, the GitHub `<a>` has no `href`. Replace it with a proper external link. In Electron's renderer, `target="_blank"` opens in the system browser when `shell.openExternal` is wired in the main process (which it is by convention). Use:

```tsx
<a
  href="https://github.com/thebristolsound/birdbrain"
  target="_blank"
  rel="noreferrer"
  className="text-accent hover:text-accent-hover"
>
  GitHub
</a>
```

- [ ] **Step 4: Verify lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/dashboard/RecentCases.tsx \
        src/renderer/components/dashboard/ExtensionBanner.tsx \
        src/renderer/components/settings/About.tsx
git commit -m "fix: remove dead View All and Learn More buttons; wire GitHub href in About"
```

---

### Task 4: Fix invalid placeholder utility class

**Problem:** `placeholder-text-muted` is a Tailwind v3 class name that generates no CSS in Tailwind v4. The correct v4 syntax for targeting the placeholder pseudo-element is the variant form `placeholder:text-text-muted`.

**Files:**
- Modify: `src/renderer/components/layout/OnboardingWizard.tsx:167`
- Modify: `src/renderer/components/cases/NewCaseWizard.tsx:127`
- Modify: `src/renderer/components/cases/NewCaseWizard.tsx:143`

- [ ] **Step 1: Fix OnboardingWizard input**

In `OnboardingWizard.tsx:167`, in the `className` of the name input, replace `placeholder-text-muted` with `placeholder:text-text-muted`:

```tsx
className="w-full rounded-xl border border-border-strong bg-elevated px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
```

- [ ] **Step 2: Fix NewCaseWizard name input**

In `NewCaseWizard.tsx:127`, same replacement on the name `<input>`:

```tsx
className="w-full rounded-xl border border-border-strong bg-elevated px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
```

- [ ] **Step 3: Fix NewCaseWizard description textarea**

In `NewCaseWizard.tsx:143`, same replacement on the description `<textarea>`:

```tsx
className="w-full resize-none rounded-xl border border-border-strong bg-elevated px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
```

- [ ] **Step 4: Verify lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/OnboardingWizard.tsx \
        src/renderer/components/cases/NewCaseWizard.tsx
git commit -m "fix: correct placeholder utility to placeholder:text-text-muted (Tailwind v4 syntax)"
```

---

### Task 5: Fix invisible interaction affordances

**Two separate issues:**

**SearchBar:** The results dropdown uses `bg-elevated` as its container background. In light mode, `elevated = #ffffff`. Result rows use `hover:bg-elevated` — same white — so hover is invisible. Fix: drop the dropdown to `bg-surface` (`#f8fafb` in light / `#0f172a` in dark) so the `hover:bg-elevated` lift is visible.

**CaseCard menu button:** The `⋮` button uses `opacity-0 group-hover:opacity-100`. It is invisible at rest, which means keyboard users tabbing to it get no visual indication it exists. Fix: add `focus-visible:opacity-100` so the button is visible when focused via keyboard.

**Files:**
- Modify: `src/renderer/components/search/SearchBar.tsx:102`
- Modify: `src/renderer/components/dashboard/CaseCard.tsx:168`

- [ ] **Step 1: Fix SearchBar dropdown background**

In `SearchBar.tsx:102`, change the dropdown container's background from `bg-elevated` to `bg-surface`:

```tsx
<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded border border-border-strong bg-surface shadow-lg">
```

- [ ] **Step 2: Add focus-visible to CaseCard menu button**

In `CaseCard.tsx:168`, add `focus-visible:opacity-100` to the button's className:

```tsx
className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded-md hover:bg-elevated transition-all"
```

- [ ] **Step 3: Verify lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/search/SearchBar.tsx \
        src/renderer/components/dashboard/CaseCard.tsx
git commit -m "fix: restore SearchBar hover contrast; add focus-visible to CaseCard menu button"
```

---

### Task 6: Fix settings scroll container height

**Problem:** The settings route in `__root.tsx` wraps `<SettingsView>` in a plain `<div className="p-6">` with no height set. `SettingsView` uses `h-full` assuming a bounded parent, but a block `div` with no explicit height doesn't provide one — so the internal `overflow-y-auto` scroll region has no height bound, causing the entire page to scroll instead of just the settings content panel.

Fix: add `h-full overflow-hidden` to the wrapper div so height flows down from the flex-1 `<main>` ancestor.

**Files:**
- Modify: `src/renderer/routes/__root.tsx:124`

- [ ] **Step 1: Add height constraint to settings wrapper**

In `__root.tsx`, the `settingsRoute` component (around line 122–128) currently renders:

```tsx
component: function SettingsPage() {
  return (
    <div className="p-6">
      <SettingsView />
    </div>
  )
}
```

Change to:

```tsx
component: function SettingsPage() {
  return (
    <div className="h-full overflow-hidden p-6">
      <SettingsView />
    </div>
  )
}
```

- [ ] **Step 2: Verify lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/routes/__root.tsx
git commit -m "fix: add h-full overflow-hidden to settings route wrapper so SettingsView scroll region is bounded"
```

---

### Task 7: Fix TopBar back navigation + captures pane min-width

**Two small layout fixes grouped because they're both single-line changes:**

**TopBar:** `router.history.back()` no-ops when `/settings` is the first entry in history (e.g. cold-start or restored session). `navigate` from `useNavigate` is already imported. Guard with `window.history.length > 1`.

**Captures pane:** `w-[30%] max-w-xs` has no lower bound — the list pane can shrink to an unusably thin column at narrow window widths. Add `min-w-[180px]`.

**Files:**
- Modify: `src/renderer/components/layout/TopBar.tsx:38`
- Modify: `src/renderer/routes/cases/$caseId/captures.tsx:10`

- [ ] **Step 1: Guard TopBar history.back() with fallback**

In `TopBar.tsx:38`, change the onClick from:

```tsx
onClick={() => router.history.back()}
```

to:

```tsx
onClick={() => window.history.length > 1 ? router.history.back() : navigate({ to: '/' })}
```

`navigate` is already in scope from `useNavigate()` at the top of the function.

- [ ] **Step 2: Add min-width to captures list pane**

In `captures.tsx:10`, change:

```tsx
<div className="w-[30%] max-w-xs overflow-y-auto border-r border-border">
```

to:

```tsx
<div className="w-[30%] min-w-[180px] max-w-xs overflow-y-auto border-r border-border">
```

- [ ] **Step 3: Verify lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/TopBar.tsx \
        src/renderer/routes/cases/$caseId/captures.tsx
git commit -m "fix: guard settings back-nav with history fallback; add min-width to captures list pane"
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: responsive grid (#1)
- ✅ Task 2: dark-only palette tokens (#2)
- ✅ Task 3: dead controls (#3)
- ✅ Task 4: placeholder typo (#4)
- ✅ Task 5: invisible affordances — both SearchBar hover and CaseCard opacity (#5)
- ✅ Task 6: settings scroll height (#6)
- ✅ Task 7: captures min-width (#7) + TopBar back nav (#8)

All 8 findings covered. No gaps.

**Placeholder scan:** No TBDs, no "similar to Task N" references, all code blocks are complete.

**Type consistency:** No new types introduced. All className strings are self-contained Tailwind utilities — no cross-task dependencies.
