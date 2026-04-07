# Motion Animation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all CSS keyframe animations with a unified Motion-based animation system featuring preset variants, named springs, and theater hooks for "illusion of labor" async operations.

**Architecture:** Two-layer system — Layer 1 provides spreadable preset variant objects and named spring configs consumed via `<motion.div {...presets.fadeUp}>`. Layer 2 provides composable hooks (`useTheater`, `useStagedReveal`, `useCompletionCelebration`) for orchestrated async sequences. A thin `<MotionProvider>` at the root sets global spring defaults and reduced-motion readiness.

**Tech Stack:** Motion (motion/react), React 19, TypeScript, Zustand, TanStack Router, Tailwind v4

**Spec:** `docs/superpowers/specs/2026-04-06-motion-animation-system-design.md`

---

## File Structure

```
Create:
  src/renderer/lib/motion/constants.ts    — timing constants
  src/renderer/lib/motion/springs.ts      — named spring configs
  src/renderer/lib/motion/presets.ts      — 10 spreadable variant objects
  src/renderer/lib/motion/provider.tsx    — MotionProvider wrapper
  src/renderer/lib/motion/index.ts        — barrel export
  src/renderer/hooks/useTheater.ts        — staged async orchestration
  src/renderer/hooks/useStagedReveal.ts   — staggered list mounting
  src/renderer/hooks/useCompletionCelebration.ts — success animations
  tests/renderer/lib/motion/springs.test.ts
  tests/renderer/lib/motion/presets.test.ts
  tests/renderer/hooks/useTheater.test.ts

Modify:
  package.json                             — add motion dependency
  src/renderer/styles/globals.css:117-170  — remove CSS keyframes & utility classes
  src/renderer/routes/__root.tsx:1-27      — wrap with MotionProvider
  src/renderer/components/dashboard/HeroSection.tsx:12-45 — replace CSS anim classes
  src/renderer/components/dashboard/CaseCard.tsx:59,103   — remove animDelay prop, use motion
  src/renderer/components/dashboard/RecentCases.tsx:25-70  — staggered reveal
  src/renderer/components/cases/CreateCaseDialog.tsx:26-80 — AnimatePresence modal
  src/renderer/components/notes/AddNoteModal.tsx:42-56     — AnimatePresence modal
  src/renderer/components/export/ExportDialog.tsx:10-50    — AnimatePresence + theater
  src/renderer/components/selectors/BulkAddSelectorsModal.tsx:115-223 — AnimatePresence modal
  src/renderer/components/cases/CaseWorkspace.tsx:84-131   — tab indicator + outlet transition
  src/renderer/components/captures/CaptureList.tsx:72-89   — staggered reveal
  src/renderer/components/status/CaptureHealth.tsx:112-113 — popover animation
  src/renderer/components/status/ConnectionStatus.tsx:7-25 — motion pulse
  src/renderer/components/status/SessionControls.tsx:59-86 — recording indicator
  src/renderer/components/cases/NewCaseWizard.tsx:92-216   — step transitions
```

---

## Task 1: Install Motion & Create Constants

**Files:**
- Modify: `package.json:58-72`
- Create: `src/renderer/lib/motion/constants.ts`
- Test: `tests/renderer/lib/motion/springs.test.ts` (started here, finished in Task 2)

- [ ] **Step 1: Install motion**

Run:
```bash
pnpm add motion
```

Expected: `motion` appears in `dependencies` in `package.json`.

- [ ] **Step 2: Create constants file**

Create `src/renderer/lib/motion/constants.ts`:

```ts
export const MIN_THEATER_MS = 800
export const MIN_STAGE_TIME_MS = 250
export const STAGGER_INTERVAL = 0.04
export const STAGGER_CAP = 20
export const CELEBRATION_HOLD_MS = 600
export const OVERLAY_DURATION = 0.2
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/lib/motion/constants.ts
git commit -m "$(cat <<'EOF'
feat: install motion and add animation timing constants
EOF
)"
```

---

## Task 2: Create Named Springs

**Files:**
- Create: `src/renderer/lib/motion/springs.ts`
- Create: `tests/renderer/lib/motion/springs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/lib/motion/springs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { springs } from '@renderer/lib/motion/springs'

describe('springs', () => {
  it('exports four named spring configs', () => {
    expect(Object.keys(springs)).toEqual(['snappy', 'gentle', 'bouncy', 'molasses'])
  })

  it('snappy is the decisive default', () => {
    expect(springs.snappy).toEqual({
      type: 'spring',
      stiffness: 400,
      damping: 30
    })
  })

  it('gentle is smooth and unhurried', () => {
    expect(springs.gentle).toEqual({
      type: 'spring',
      stiffness: 200,
      damping: 24
    })
  })

  it('bouncy has playful overshoot', () => {
    expect(springs.bouncy).toEqual({
      type: 'spring',
      stiffness: 500,
      damping: 15
    })
  })

  it('molasses is deliberately slow', () => {
    expect(springs.molasses).toEqual({
      type: 'spring',
      stiffness: 120,
      damping: 20
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/renderer/lib/motion/springs.test.ts`

Expected: FAIL — cannot resolve `@renderer/lib/motion/springs`

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lib/motion/springs.ts`:

```ts
import type { Transition } from 'motion/react'

type SpringConfig = Extract<Transition, { type: 'spring' }>

export const springs = {
  snappy: {
    type: 'spring',
    stiffness: 400,
    damping: 30
  },
  gentle: {
    type: 'spring',
    stiffness: 200,
    damping: 24
  },
  bouncy: {
    type: 'spring',
    stiffness: 500,
    damping: 15
  },
  molasses: {
    type: 'spring',
    stiffness: 120,
    damping: 20
  }
} as const satisfies Record<string, SpringConfig>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/renderer/lib/motion/springs.test.ts`

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/motion/springs.ts tests/renderer/lib/motion/springs.test.ts
git commit -m "$(cat <<'EOF'
feat: add named spring configurations (snappy, gentle, bouncy, molasses)
EOF
)"
```

---

## Task 3: Create Preset Variants

**Files:**
- Create: `src/renderer/lib/motion/presets.ts`
- Create: `tests/renderer/lib/motion/presets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/lib/motion/presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { presets } from '@renderer/lib/motion/presets'

describe('presets', () => {
  const presetNames = [
    'fadeUp', 'fadeIn', 'scaleIn', 'modal', 'overlay',
    'slidePanel', 'listItem', 'stagger', 'popover', 'collapse'
  ]

  it('exports all 10 preset variants', () => {
    expect(Object.keys(presets).sort()).toEqual(presetNames.sort())
  })

  for (const name of presetNames) {
    it(`${name} has initial and animate properties`, () => {
      const preset = presets[name as keyof typeof presets]
      expect(preset).toHaveProperty('initial')
      expect(preset).toHaveProperty('animate')
    })
  }

  it('fadeUp animates opacity and y', () => {
    expect(presets.fadeUp.initial).toEqual({ opacity: 0, y: 8 })
    expect(presets.fadeUp.animate).toEqual({ opacity: 1, y: 0 })
  })

  it('modal uses gentle spring', () => {
    expect(presets.modal.transition).toMatchObject({
      type: 'spring',
      stiffness: 200,
      damping: 24
    })
  })

  it('overlay uses tween duration, not spring', () => {
    expect(presets.overlay.transition).toMatchObject({
      duration: 0.2
    })
  })

  it('stagger configures parent orchestration', () => {
    expect(presets.stagger.animate).toHaveProperty('transition')
    const transition = (presets.stagger.animate as Record<string, unknown>).transition as Record<string, unknown>
    expect(transition.staggerChildren).toBe(0.04)
  })

  it('all presets with exit have reversed entrance', () => {
    expect(presets.fadeUp.exit).toEqual({ opacity: 0, y: 8 })
    expect(presets.modal.exit).toMatchObject({ opacity: 0, scale: 0.96 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/renderer/lib/motion/presets.test.ts`

Expected: FAIL — cannot resolve `@renderer/lib/motion/presets`

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lib/motion/presets.ts`:

```ts
import { springs } from './springs'
import { STAGGER_INTERVAL, OVERLAY_DURATION } from './constants'

function makePreset(
  initial: Record<string, unknown>,
  animate: Record<string, unknown>,
  transition: Record<string, unknown>,
  exit?: Record<string, unknown>
) {
  return {
    initial,
    animate,
    exit: exit ?? initial,
    transition
  }
}

export const presets = {
  fadeUp: makePreset(
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0 },
    springs.snappy
  ),

  fadeIn: makePreset(
    { opacity: 0 },
    { opacity: 1 },
    springs.snappy
  ),

  scaleIn: makePreset(
    { opacity: 0, scale: 0.95 },
    { opacity: 1, scale: 1 },
    springs.snappy
  ),

  modal: makePreset(
    { opacity: 0, scale: 0.96, y: 12 },
    { opacity: 1, scale: 1, y: 0 },
    springs.gentle
  ),

  overlay: makePreset(
    { opacity: 0 },
    { opacity: 1 },
    { duration: OVERLAY_DURATION }
  ),

  slidePanel: makePreset(
    { opacity: 0, x: '100%' },
    { opacity: 1, x: 0 },
    springs.gentle,
    { opacity: 0, x: '100%' }
  ),

  listItem: makePreset(
    { opacity: 0, x: -8 },
    { opacity: 1, x: 0 },
    springs.snappy
  ),

  stagger: {
    initial: 'hidden',
    animate: {
      transition: {
        staggerChildren: STAGGER_INTERVAL
      }
    },
    exit: 'hidden'
  },

  popover: makePreset(
    { opacity: 0, scale: 0.97, y: -4 },
    { opacity: 1, scale: 1, y: 0 },
    springs.snappy
  ),

  collapse: makePreset(
    { opacity: 0, height: 0 },
    { opacity: 1, height: 'auto' },
    springs.snappy
  )
} as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/renderer/lib/motion/presets.test.ts`

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/motion/presets.ts tests/renderer/lib/motion/presets.test.ts
git commit -m "$(cat <<'EOF'
feat: add 10 animation preset variants (fadeUp, modal, stagger, etc.)
EOF
)"
```

---

## Task 4: Create MotionProvider & Barrel Export

**Files:**
- Create: `src/renderer/lib/motion/provider.tsx`
- Create: `src/renderer/lib/motion/index.ts`
- Modify: `src/renderer/routes/__root.tsx:1-27`

- [ ] **Step 1: Create the provider**

Create `src/renderer/lib/motion/provider.tsx`:

```tsx
import { MotionConfig } from 'motion/react'
import { springs } from './springs'
import type { ReactNode } from 'react'

interface MotionProviderProps {
  children: ReactNode
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <MotionConfig
      transition={springs.snappy}
      reducedMotion="user"
    >
      {children}
    </MotionConfig>
  )
}
```

- [ ] **Step 2: Create the barrel export**

Create `src/renderer/lib/motion/index.ts`:

```ts
export { springs } from './springs'
export { presets } from './presets'
export { MotionProvider } from './provider'
export {
  MIN_THEATER_MS,
  MIN_STAGE_TIME_MS,
  STAGGER_INTERVAL,
  STAGGER_CAP,
  CELEBRATION_HOLD_MS,
  OVERLAY_DURATION
} from './constants'
```

- [ ] **Step 3: Wire MotionProvider into the root layout**

Modify `src/renderer/routes/__root.tsx`. Add the import at line 1 area and wrap the root layout content:

```tsx
import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { TopBar } from '@renderer/components/layout/TopBar'
import { MotionProvider } from '@renderer/lib/motion'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { NewCaseWizard } from '@renderer/components/cases/NewCaseWizard'
import { CaseWorkspace } from '@renderer/components/cases/CaseWorkspace'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CapturesRoute } from '@renderer/routes/cases/$caseId/captures'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'
import { NotesOverview } from '@renderer/components/notes/NotesOverview'
import { TagsOverview } from '@renderer/components/tags/TagsOverview'
import { SettingsView } from '@renderer/components/settings/SettingsView'

// Root layout
const rootRoute = createRootRoute({
  component: function RootLayout() {
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
      </MotionProvider>
    )
  }
})
```

- [ ] **Step 4: Verify the app builds**

Run: `pnpm build`

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/motion/provider.tsx src/renderer/lib/motion/index.ts src/renderer/routes/__root.tsx
git commit -m "$(cat <<'EOF'
feat: add MotionProvider and wire into root layout
EOF
)"
```

---

## Task 5: Remove CSS Keyframes & Utility Classes

**Files:**
- Modify: `src/renderer/styles/globals.css:117-170`

This task removes all CSS animation infrastructure that Motion replaces. The `html.transitioning` block (lines 97-101), neumorphic card styles (lines 172-181), glow effects (lines 183-189), shimmer text (lines 191-206), and logo-pulse (lines 208-221) are **kept** — they'll be migrated in their respective component tasks.

- [ ] **Step 1: Remove keyframes and utility classes**

Remove lines 117-170 from `src/renderer/styles/globals.css`. This removes:

- `@keyframes fadeIn` (lines 118-121) and `.anim-in` (line 122)
- `@keyframes fadeUp` (lines 124-127)
- `@keyframes scaleIn` (lines 128-131)
- `@keyframes float` (lines 132-135)
- `@keyframes shimmer` (lines 136-139)
- `@keyframes pulse-ring` (lines 140-143)
- `@keyframes glow-pulse` (lines 144-147)
- `@keyframes expandIn` (lines 148-151)
- `@keyframes softPulse` (lines 152-155)
- `.anim-up`, `.anim-scale`, `.expand-panel`, `.test-active` (lines 157-160)
- `.d1` through `.d9` delay classes (lines 162-170)

**Keep:** The `/* === Animations === */` comment can be removed too. Keep everything above line 117 and everything from line 172 onward (`/* === Neumorphic cards === */`).

**Important:** Also keep the `@keyframes shimmer` definition and `@keyframes float` and `@keyframes pulse-ring` and `@keyframes glow-pulse` since they are still referenced by `.shimmer-text` (line 198) and `.logo-pulse` (line 211). These will be migrated when HeroSection is converted. So actually — only remove:

- `@keyframes fadeIn` + `.anim-in`
- `@keyframes fadeUp` + `.anim-up`
- `@keyframes scaleIn` + `.anim-scale`
- `@keyframes expandIn` + `.expand-panel`
- `@keyframes softPulse` + `.test-active`
- `.d1` through `.d9`

Keep `@keyframes float`, `shimmer`, `pulse-ring`, `glow-pulse` since `.shimmer-text` and `.logo-pulse` still reference them. Those will be migrated in Task 6.

The CSS to remove:

```css
/* Remove these: */
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
```

- [ ] **Step 2: Verify no remaining references to removed classes**

Run:
```bash
grep -rn "anim-in\|anim-up\|anim-scale\|expand-panel\|test-active\|\.d[1-9]" src/renderer/
```

Expected: Hits in component files (HeroSection, CaseCard, RecentCases, etc.) — these will be migrated in subsequent tasks. No hits in CSS files.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/globals.css
git commit -m "$(cat <<'EOF'
refactor: remove CSS keyframe animations replaced by Motion presets
EOF
)"
```

---

## Task 6: Migrate Dashboard — HeroSection

**Files:**
- Modify: `src/renderer/components/dashboard/HeroSection.tsx`
- Modify: `src/renderer/styles/globals.css` (remove `.logo-pulse`, `.shimmer-text`, and related keyframes)

- [ ] **Step 1: Convert HeroSection to use Motion presets**

Replace the contents of `src/renderer/components/dashboard/HeroSection.tsx`:

```tsx
import { Radar, PlusCircle, FolderOpen } from 'lucide-react'
import { motion } from 'motion/react'
import { presets } from '@renderer/lib/motion'

interface HeroSectionProps {
  onNewInvestigation: () => void
  onOpenRecent: () => void
}

export function HeroSection({ onNewInvestigation, onOpenRecent }: HeroSectionProps) {
  return (
    <section className="relative pt-16 pb-12 px-8">
      <motion.div
        className="max-w-3xl mx-auto text-center"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08 } }
        }}
      >
        <motion.div
          className="flex justify-center mb-8"
          variants={{
            hidden: { opacity: 0, scale: 0.9 },
            visible: { opacity: 1, scale: 1 }
          }}
        >
          <div className="logo-pulse w-16 h-16 rounded-2xl bg-accent flex items-center justify-center">
            <Radar className="h-8 w-8 text-white" />
          </div>
        </motion.div>

        <motion.h1
          className="font-display font-extrabold text-4xl tracking-tight text-text-primary mb-3"
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 }
          }}
        >
          Welcome to <span className="shimmer-text">Birdbrain</span>
        </motion.h1>

        <motion.p
          className="text-base text-text-muted max-w-lg mx-auto leading-relaxed mb-10"
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 }
          }}
        >
          Your comprehensive open-source intelligence platform. Capture, extract, and analyze web
          intelligence with precision.
        </motion.p>

        <motion.div
          className="flex items-center justify-center gap-4 mb-6"
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 }
          }}
        >
          <button
            data-testid="new-case-btn"
            onClick={onNewInvestigation}
            className="group flex items-center gap-3 px-7 py-4 bg-accent hover:bg-accent-hover text-white font-display font-bold text-sm rounded-2xl shadow-lg shadow-indigo-500/40 hover:shadow-xl hover:shadow-indigo-500/50 transition-all active:scale-[0.98]"
          >
            <PlusCircle className="h-5 w-5 group-hover:rotate-90 transition-transform duration-300" />
            Start New Investigation
          </button>
          <button
            onClick={onOpenRecent}
            className="flex items-center gap-3 px-6 py-4 border border-border-strong hover:border-accent hover:bg-accent-subtle text-text-primary font-display font-semibold text-sm rounded-2xl transition-all active:scale-[0.98]"
          >
            <FolderOpen className="h-5 w-5 text-accent" />
            Open Recent Case
          </button>
        </motion.div>

        <motion.p
          className="text-[11px] text-text-faint"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1 }
          }}
        >
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            Ctrl
          </kbd>
          {' + '}
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            N
          </kbd>
          <span className="ml-1.5">to create · </span>
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            Ctrl
          </kbd>
          {' + '}
          <kbd className="px-1.5 py-0.5 rounded border border-border-strong bg-surface font-mono text-[10px] font-medium text-text-muted">
            K
          </kbd>
          <span className="ml-1.5">to search</span>
        </motion.p>
      </motion.div>
    </section>
  )
}
```

Note: `.logo-pulse` and `.shimmer-text` CSS classes are kept for now — they use CSS-only effects (background gradients, pseudo-elements) that don't benefit from Motion. They can be revisited in a future polish pass.

- [ ] **Step 2: Verify no remaining CSS animation classes on HeroSection**

Run:
```bash
grep -n "anim-in\|anim-up\|anim-scale\|\.d[1-9]" src/renderer/components/dashboard/HeroSection.tsx
```

Expected: No matches.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/dashboard/HeroSection.tsx
git commit -m "$(cat <<'EOF'
feat: migrate HeroSection from CSS to Motion staggered animations
EOF
)"
```

---

## Task 7: Migrate Dashboard — CaseCard & RecentCases

**Files:**
- Modify: `src/renderer/components/dashboard/CaseCard.tsx:59,103`
- Modify: `src/renderer/components/dashboard/RecentCases.tsx:25-70`

- [ ] **Step 1: Remove animDelay prop from CaseCard and replace CSS classes**

In `src/renderer/components/dashboard/CaseCard.tsx`:

1. Remove `animDelay = 'd5'` from the props interface and destructuring (line 59 area).
2. Replace line 103 — change:
   ```tsx
   className={`anim-scale ${animDelay} neu-card rounded-2xl p-5 cursor-pointer group relative`}
   ```
   to:
   ```tsx
   className="neu-card rounded-2xl p-5 cursor-pointer group relative"
   ```
3. Remove `animDelay` from the `CaseCardProps` interface.

The card itself becomes a plain `div` — the parent (`RecentCases`) will handle staggering via Motion variants.

- [ ] **Step 2: Convert RecentCases to use Motion staggered container**

Replace the contents of `src/renderer/components/dashboard/RecentCases.tsx`:

```tsx
import { Plus, ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import type { Case } from '@shared/types'
import { CaseCard } from './CaseCard'
import { presets } from '@renderer/lib/motion'

interface RecentCasesProps {
  cases: Case[]
  captureCounts: Record<string, number>
  onSelectCase: (id: string) => void
  onNewCase: () => void
  onRenameCase: (id: string, name: string) => void
  onDeleteCase: (id: string) => void
}

export function RecentCases({
  cases,
  captureCounts,
  onSelectCase,
  onNewCase,
  onRenameCase,
  onDeleteCase
}: RecentCasesProps) {
  return (
    <section className="px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        <motion.div {...presets.fadeUp} className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="font-display font-bold text-lg tracking-tight text-text-primary">
              Recent Cases
            </h2>
            <span className="rounded-full border border-border-strong bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-text-muted">
              {cases.length} {cases.length === 1 ? 'case' : 'cases'}
            </span>
          </div>
          <button className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-accent hover:text-accent transition-colors">
            <span>View All</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } }
          }}
        >
          {cases.slice(0, 3).map((c) => (
            <motion.div
              key={c.id}
              variants={{
                hidden: { opacity: 0, scale: 0.95 },
                visible: { opacity: 1, scale: 1 }
              }}
            >
              <CaseCard
                caseData={c}
                isRecording={false}
                isActive={false}
                captureCount={captureCounts[c.id] || 0}
                onClick={() => onSelectCase(c.id)}
                onRename={onRenameCase}
                onDelete={onDeleteCase}
              />
            </motion.div>
          ))}

          <motion.div
            onClick={onNewCase}
            className="new-case-card cursor-pointer rounded-2xl border-2 border-dashed p-5 transition-all flex flex-col items-center justify-center text-center min-h-[260px] group"
            variants={{
              hidden: { opacity: 0, scale: 0.95 },
              visible: { opacity: 1, scale: 1 }
            }}
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent-subtle transition-colors group-hover:bg-accent-subtle">
              <Plus className="h-6 w-6 text-accent transition-transform duration-300 group-hover:rotate-90" />
            </div>
            <h3 className="font-display font-bold text-sm text-accent mb-1">
              New Investigation
            </h3>
            <p className="text-[11px] text-accent leading-relaxed">
              Start a fresh case with
              <br />
              guided setup
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Verify no remaining CSS animation classes**

Run:
```bash
grep -n "anim-\|animDelay\|\.d[1-9]" src/renderer/components/dashboard/CaseCard.tsx src/renderer/components/dashboard/RecentCases.tsx
```

Expected: No matches.

- [ ] **Step 4: Run the app in dev mode to check visuals**

Run: `pnpm dev`

Expected: Dashboard renders with staggered card entrance animations via Motion springs instead of CSS keyframes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/dashboard/CaseCard.tsx src/renderer/components/dashboard/RecentCases.tsx
git commit -m "$(cat <<'EOF'
feat: migrate dashboard cards to Motion staggered animations
EOF
)"
```

---

## Task 8: Animate Modal & Dialog System

**Files:**
- Modify: `src/renderer/components/cases/CreateCaseDialog.tsx:26-80`
- Modify: `src/renderer/components/notes/AddNoteModal.tsx:42-56`
- Modify: `src/renderer/components/export/ExportDialog.tsx`
- Modify: `src/renderer/components/selectors/BulkAddSelectorsModal.tsx`

- [ ] **Step 1: Add AnimatePresence to CreateCaseDialog**

The dialog is rendered conditionally by its parent. The parent must wrap it in `<AnimatePresence>`. But since CreateCaseDialog renders its own overlay, we convert the overlay and card to motion elements.

Modify `src/renderer/components/cases/CreateCaseDialog.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { useCasesMutations } from '@renderer/lib/queries'
import { presets } from '@renderer/lib/motion'

interface CreateCaseDialogProps {
  onClose: () => void
}

export function CreateCaseDialog({ onClose }: CreateCaseDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const { create } = useCasesMutations()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const newCase = await create.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined
    })
    navigate({ to: '/cases/$caseId', params: { caseId: newCase.id } })
    onClose()
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      {...presets.overlay}
    >
      <motion.div
        className="w-96 rounded-lg border border-border-strong bg-card p-6"
        onClick={(e) => e.stopPropagation()}
        {...presets.modal}
      >
        <h2 className="mb-4 text-lg font-semibold text-text-primary">New Case</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-text-muted">Name</label>
            <input
              data-testid="case-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="Investigation name..."
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-text-muted">Description (optional)</label>
            <textarea
              data-testid="case-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-border-strong bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              placeholder="What is this investigation about?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              data-testid="case-create-btn"
              type="submit"
              disabled={!name.trim()}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Wrap CreateCaseDialog render site with AnimatePresence**

Find where `CreateCaseDialog` is conditionally rendered (its parent component). Wrap the conditional render with `<AnimatePresence>`:

```tsx
import { AnimatePresence } from 'motion/react'

// In the parent's JSX:
<AnimatePresence>
  {showCreateDialog && <CreateCaseDialog onClose={() => setShowCreateDialog(false)} />}
</AnimatePresence>
```

Search for the render site:
```bash
grep -rn "CreateCaseDialog" src/renderer/
```

Apply this `<AnimatePresence>` wrapping pattern to each render site.

- [ ] **Step 3: Apply same pattern to AddNoteModal**

In `src/renderer/components/notes/AddNoteModal.tsx`:
- Add `import { motion, AnimatePresence } from 'motion/react'` and `import { presets } from '@renderer/lib/motion'`
- Change the early return pattern. Instead of `if (!open) return null`, keep the component always mounted and wrap the modal JSX in `<AnimatePresence>`:

```tsx
return (
  <AnimatePresence>
    {open && (
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={onClose}
        {...presets.overlay}
      >
        <motion.div
          className="..."
          onClick={(e) => e.stopPropagation()}
          {...presets.modal}
        >
          {/* existing modal content */}
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
)
```

- [ ] **Step 4: Apply same pattern to ExportDialog**

In `src/renderer/components/export/ExportDialog.tsx`:
- Add motion imports
- Wrap the backdrop `div` with `motion.div` + `{...presets.overlay}`
- Wrap the dialog card with `motion.div` + `{...presets.modal}`
- The parent should wrap `<ExportDialog>` in `<AnimatePresence>`

- [ ] **Step 5: Apply same pattern to BulkAddSelectorsModal**

In `src/renderer/components/selectors/BulkAddSelectorsModal.tsx`:
- Same motion import + overlay/modal preset pattern
- The parent should wrap in `<AnimatePresence>`

- [ ] **Step 6: Verify all modals animate**

Run: `pnpm dev`

Open and close each modal/dialog. Expected: Smooth fade-in/scale-up on open, fade-out/scale-down on close.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/cases/CreateCaseDialog.tsx src/renderer/components/notes/AddNoteModal.tsx src/renderer/components/export/ExportDialog.tsx src/renderer/components/selectors/BulkAddSelectorsModal.tsx
git add -u  # catch any parent files that needed AnimatePresence wrapping
git commit -m "$(cat <<'EOF'
feat: add AnimatePresence entrance/exit animations to all modals
EOF
)"
```

---

## Task 9: Add Route Transitions

**Files:**
- Modify: `src/renderer/routes/__root.tsx:17-24`

- [ ] **Step 1: Add AnimatePresence to the root Outlet**

Modify `src/renderer/routes/__root.tsx`. Wrap the `<Outlet />` with `AnimatePresence` and a keyed `motion.div`:

```tsx
import { createRootRoute, createRoute, Outlet, useMatches } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { TopBar } from '@renderer/components/layout/TopBar'
import { MotionProvider } from '@renderer/lib/motion'
import { presets } from '@renderer/lib/motion'
// ... rest of imports

const rootRoute = createRootRoute({
  component: function RootLayout() {
    const matches = useMatches()
    const routeKey = matches[matches.length - 1]?.id ?? 'root'

    return (
      <MotionProvider>
        <div className="flex h-screen flex-col bg-canvas text-text-secondary">
          <TopBar />
          <div className="flex flex-1 overflow-hidden">
            <main className="flex-1 overflow-auto bg-canvas">
              <AnimatePresence mode="wait">
                <motion.div
                  key={routeKey}
                  {...presets.fadeUp}
                  className="h-full"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      </MotionProvider>
    )
  }
})
```

- [ ] **Step 2: Test route transitions**

Run: `pnpm dev`

Navigate between Dashboard → Settings → Case Workspace. Expected: Content fades up on entry and fades down on exit with spring physics.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/routes/__root.tsx
git commit -m "$(cat <<'EOF'
feat: add route transition animations via AnimatePresence
EOF
)"
```

---

## Task 10: Add Tab Transitions in CaseWorkspace

**Files:**
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx:84-131`

- [ ] **Step 1: Add animated tab underline and content transition**

In `src/renderer/components/cases/CaseWorkspace.tsx`:

1. Add imports:
```tsx
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion'
```

2. Add a `motion.div` with `layoutId="tab-indicator"` inside each active tab `<Link>` for the sliding underline effect. Add it as a child of the Link, conditionally rendered when `isActive`:

```tsx
<Link
  key={tab.id}
  to={tabPath(tab.id)}
  params={{ caseId: caseId }}
  className={`relative flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-xs font-medium transition-colors ${
    isActive
      ? 'font-semibold text-accent'
      : 'text-text-muted hover:text-text-primary hover:bg-elevated'
  }`}
>
  <Icon className="h-3.5 w-3.5" />
  {tab.label}
  {badgeCount !== null && (
    <span
      data-testid={`tab-badge-${tab.id}`}
      className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        isActive ? 'bg-accent-subtle text-accent' : 'bg-elevated text-text-muted'
      }`}
    >
      {badgeCount}
    </span>
  )}
  {isActive && (
    <motion.div
      layoutId="tab-indicator"
      className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full"
    />
  )}
</Link>
```

3. Wrap the tab content `<Outlet />` with `AnimatePresence`:

```tsx
{/* Tab content */}
<AnimatePresence mode="wait">
  {isCaptures ? (
    <motion.div key="captures" {...presets.fadeIn} className="flex-1 overflow-hidden">
      <Outlet />
    </motion.div>
  ) : (
    <motion.div key={activeTabId} {...presets.fadeIn} className="flex-1 overflow-auto p-6">
      <Outlet />
    </motion.div>
  )}
</AnimatePresence>
```

You'll need to derive `activeTabId` from the current route. Add near the top of the component:

```tsx
const activeTabId = tabs.find(t => isTabActive(t.id))?.id ?? 'overview'
```

- [ ] **Step 2: Test tab transitions**

Run: `pnpm dev`

Navigate to a case workspace and switch between tabs. Expected: Underline slides smoothly between tabs. Tab content fades in/out.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "$(cat <<'EOF'
feat: add animated tab indicator and content transitions in CaseWorkspace
EOF
)"
```

---

## Task 11: Animate Capture List with Staggered Reveal

**Files:**
- Create: `src/renderer/hooks/useStagedReveal.ts`
- Modify: `src/renderer/components/captures/CaptureList.tsx:72-89`

- [ ] **Step 1: Create the useStagedReveal hook**

Create `src/renderer/hooks/useStagedReveal.ts`:

```ts
import { useRef } from 'react'
import { springs } from '@renderer/lib/motion'
import { STAGGER_INTERVAL, STAGGER_CAP } from '@renderer/lib/motion'

interface UseStagedRevealOptions {
  items: unknown[]
  staggerInterval?: number
  preset?: 'listItem' | 'fadeUp' | 'scaleIn'
}

const presetVariants = {
  listItem: {
    hidden: { opacity: 0, x: -8 },
    visible: { opacity: 1, x: 0 }
  },
  fadeUp: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0 }
  },
  scaleIn: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 }
  }
}

export function useStagedReveal({
  items,
  staggerInterval = STAGGER_INTERVAL,
  preset = 'listItem'
}: UseStagedRevealOptions) {
  const prevLengthRef = useRef(items.length)
  const hasChanged = items.length !== prevLengthRef.current
  prevLengthRef.current = items.length

  const containerProps = {
    initial: 'hidden' as const,
    animate: 'visible' as const,
    variants: {
      hidden: {},
      visible: {
        transition: {
          staggerChildren: staggerInterval,
          // Cap stagger so long lists don't waterfall forever
          ...(items.length > STAGGER_CAP && {
            staggerChildren: staggerInterval * (STAGGER_CAP / items.length)
          })
        }
      }
    }
  }

  const itemProps = {
    variants: presetVariants[preset],
    transition: springs.snappy
  }

  return { containerProps, itemProps }
}
```

- [ ] **Step 2: Apply useStagedReveal to CaptureList**

In `src/renderer/components/captures/CaptureList.tsx`:

1. Add imports:
```tsx
import { motion, AnimatePresence } from 'motion/react'
import { useStagedReveal } from '@renderer/hooks/useStagedReveal'
```

2. Inside the component, add the hook:
```tsx
const { containerProps, itemProps } = useStagedReveal({
  items: displayedCaptures,
  preset: 'listItem'
})
```

3. Change the scrollable list container (line 73 area) from `<div>` to `<motion.div>` with `{...containerProps}`:
```tsx
<motion.div className="flex-1 space-y-1 overflow-y-auto p-2" {...containerProps}>
  <AnimatePresence>
    {displayedCaptures.map((cap) => (
      <motion.div key={cap.id} {...itemProps}>
        <CaptureItem
          capture={cap}
          isSelected={cap.id === selectedCaptureId}
          onClick={() => selectCapture(cap.id)}
          isFavorite={favorites.has(cap.id)}
          onToggleFavorite={() => toggleFavorite(cap.id)}
        />
      </motion.div>
    ))}
  </AnimatePresence>
  {displayedCaptures.length === 0 && (
    <div className="px-3 py-4 text-center text-xs text-text-faint">
      {filteredCaptureIds ? 'No captures match the active filters' : 'No captures yet'}
    </div>
  )}
</motion.div>
```

- [ ] **Step 3: Test capture list staggering**

Run: `pnpm dev`

Navigate to a case with captures. Expected: Capture items stagger in from the left with spring physics. Changing filters re-triggers the stagger animation.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/useStagedReveal.ts src/renderer/components/captures/CaptureList.tsx
git commit -m "$(cat <<'EOF'
feat: add useStagedReveal hook and staggered capture list animations
EOF
)"
```

---

## Task 12: Animate Status Indicators & Dropdowns

**Files:**
- Modify: `src/renderer/components/status/CaptureHealth.tsx:112-113`
- Modify: `src/renderer/components/status/ConnectionStatus.tsx`
- Modify: `src/renderer/components/status/SessionControls.tsx`

- [ ] **Step 1: Animate CaptureHealth dropdown**

In `src/renderer/components/status/CaptureHealth.tsx`:

1. Add imports:
```tsx
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion'
```

2. Wrap the dropdown conditional (line 112 `{open && (`) with `<AnimatePresence>` and convert the dropdown `div` to `motion.div`:

```tsx
<AnimatePresence>
  {open && (
    <motion.div
      className="absolute right-0 top-full z-50 mt-2 w-96 rounded-lg border border-border bg-surface shadow-xl"
      {...presets.popover}
    >
      {/* existing dropdown content */}
    </motion.div>
  )}
</AnimatePresence>
```

- [ ] **Step 2: Animate ConnectionStatus**

In `src/renderer/components/status/ConnectionStatus.tsx`:

1. Add imports:
```tsx
import { motion } from 'motion/react'
import { springs } from '@renderer/lib/motion'
```

2. Replace the status dot's static rendering with a Motion infinite pulse. For the connected state dot, use:
```tsx
<motion.span
  className="h-2 w-2 rounded-full bg-emerald-400"
  animate={{
    scale: [1, 1.3, 1],
    opacity: [1, 0.7, 1]
  }}
  transition={{
    duration: 2,
    repeat: Infinity,
    ease: 'easeInOut'
  }}
/>
```

- [ ] **Step 3: Animate SessionControls recording indicator**

In `src/renderer/components/status/SessionControls.tsx`:

1. Add imports:
```tsx
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion'
```

2. If there's a recording indicator that appears when `sessionActive` is true, wrap it in `<AnimatePresence>` with `presets.fadeIn`.

- [ ] **Step 4: Test status animations**

Run: `pnpm dev`

Expected: CaptureHealth dropdown slides in with popover spring. Connection dot pulses smoothly. Recording indicator fades in/out.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/status/CaptureHealth.tsx src/renderer/components/status/ConnectionStatus.tsx src/renderer/components/status/SessionControls.tsx
git commit -m "$(cat <<'EOF'
feat: add Motion animations to status indicators and dropdowns
EOF
)"
```

---

## Task 13: Create useTheater Hook

**Files:**
- Create: `src/renderer/hooks/useTheater.ts`
- Create: `tests/renderer/hooks/useTheater.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/hooks/useTheater.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We test the pure logic, not the React hook wrapper
// Extract the theater state machine logic for testability

describe('theater state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances through stages over time', () => {
    const { createTheaterMachine } = require('@renderer/hooks/useTheater')
    const machine = createTheaterMachine({
      stages: ['receiving', 'processing', 'done'],
      minDuration: 800,
      minStageTime: 250
    })

    expect(machine.getState().stage).toBe('receiving')
    expect(machine.getState().progress).toBe(0)

    machine.tick(300)
    expect(machine.getState().stage).toBe('processing')

    machine.tick(300)
    expect(machine.getState().stage).toBe('done')
  })

  it('holds final stage until minDuration elapses after done signal', () => {
    const { createTheaterMachine } = require('@renderer/hooks/useTheater')
    const machine = createTheaterMachine({
      stages: ['receiving', 'processing'],
      minDuration: 800,
      minStageTime: 250
    })

    // Signal done immediately
    machine.signalDone()
    machine.tick(250)
    expect(machine.getState().isComplete).toBe(false)

    machine.tick(600)
    expect(machine.getState().isComplete).toBe(true)
  })

  it('progress never goes backwards', () => {
    const { createTheaterMachine } = require('@renderer/hooks/useTheater')
    const machine = createTheaterMachine({
      stages: ['a', 'b'],
      minDuration: 600,
      minStageTime: 200
    })

    machine.tick(200)
    const p1 = machine.getState().progress

    machine.tick(100)
    const p2 = machine.getState().progress

    expect(p2).toBeGreaterThanOrEqual(p1)
  })

  it('blends actual progress when provided', () => {
    const { createTheaterMachine } = require('@renderer/hooks/useTheater')
    const machine = createTheaterMachine({
      stages: ['uploading'],
      minDuration: 800,
      minStageTime: 250
    })

    machine.setActualProgress(0.8)
    machine.tick(100)
    // Progress should reflect actual progress blended with pacing
    expect(machine.getState().progress).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/renderer/hooks/useTheater.test.ts`

Expected: FAIL — cannot resolve `@renderer/hooks/useTheater`

- [ ] **Step 3: Write the implementation**

Create `src/renderer/hooks/useTheater.ts`:

```ts
import { useState, useEffect, useRef, useCallback } from 'react'
import { MIN_THEATER_MS, MIN_STAGE_TIME_MS } from '@renderer/lib/motion'

interface TheaterOptions {
  stages: string[]
  minDuration?: number
  minStageTime?: number
  done?: boolean
  actualProgress?: number
}

interface TheaterState {
  stage: string
  progress: number
  isComplete: boolean
}

// Exported for testability — pure state machine with no React dependency
export function createTheaterMachine(options: Omit<TheaterOptions, 'done' | 'actualProgress'>) {
  const { stages, minDuration = MIN_THEATER_MS, minStageTime = MIN_STAGE_TIME_MS } = options
  let elapsed = 0
  let doneSignaled = false
  let doneAt: number | null = null
  let actualProgress = 0
  let highWaterProgress = 0

  function getState(): TheaterState {
    const totalMinTime = stages.length * minStageTime
    const paceProgress = Math.min(elapsed / totalMinTime, 1)

    // Blend paced progress with actual if provided
    const blended = actualProgress > 0
      ? Math.max(paceProgress, actualProgress)
      : paceProgress

    // Never go backwards
    highWaterProgress = Math.max(highWaterProgress, blended)

    const stageIndex = Math.min(
      Math.floor(highWaterProgress * stages.length),
      stages.length - 1
    )

    const isComplete = doneSignaled && doneAt !== null && (elapsed - doneAt) >= minDuration

    return {
      stage: stages[stageIndex],
      progress: highWaterProgress,
      isComplete
    }
  }

  return {
    getState,
    tick(ms: number) {
      elapsed += ms
    },
    signalDone() {
      if (!doneSignaled) {
        doneSignaled = true
        doneAt = elapsed
      }
    },
    setActualProgress(p: number) {
      actualProgress = Math.max(0, Math.min(1, p))
    }
  }
}

export function useTheater(options: TheaterOptions): TheaterState {
  const { stages, minDuration = MIN_THEATER_MS, minStageTime = MIN_STAGE_TIME_MS, done = false, actualProgress = 0 } = options
  const machineRef = useRef(createTheaterMachine({ stages, minDuration, minStageTime }))
  const [state, setState] = useState<TheaterState>(() => machineRef.current.getState())

  useEffect(() => {
    if (done) machineRef.current.signalDone()
  }, [done])

  useEffect(() => {
    machineRef.current.setActualProgress(actualProgress)
  }, [actualProgress])

  useEffect(() => {
    if (state.isComplete) return

    const interval = setInterval(() => {
      machineRef.current.tick(50)
      const next = machineRef.current.getState()
      setState(next)
      if (next.isComplete) clearInterval(interval)
    }, 50)

    return () => clearInterval(interval)
  }, [state.isComplete])

  return state
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/renderer/hooks/useTheater.test.ts`

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useTheater.ts tests/renderer/hooks/useTheater.test.ts
git commit -m "$(cat <<'EOF'
feat: add useTheater hook for staged async operation pacing
EOF
)"
```

---

## Task 14: Create useCompletionCelebration Hook

**Files:**
- Create: `src/renderer/hooks/useCompletionCelebration.ts`

- [ ] **Step 1: Write the implementation**

Create `src/renderer/hooks/useCompletionCelebration.ts`:

```ts
import { useState, useCallback, useRef } from 'react'
import { springs } from '@renderer/lib/motion'
import { CELEBRATION_HOLD_MS } from '@renderer/lib/motion'

type CelebrationStyle = 'checkmark' | 'pulse' | 'ripple'

interface CompletionCelebrationOptions {
  style?: CelebrationStyle
  holdDuration?: number
}

interface CelebrationProps {
  animate?: Record<string, unknown>
  transition?: Record<string, unknown>
}

export function useCompletionCelebration(options: CompletionCelebrationOptions = {}) {
  const { style = 'pulse', holdDuration = CELEBRATION_HOLD_MS } = options
  const [celebrating, setCelebrating] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const celebrate = useCallback(() => {
    setCelebrating(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCelebrating(false), holdDuration)
  }, [holdDuration])

  const celebrationProps: CelebrationProps = celebrating
    ? getCelebrationAnimation(style)
    : {}

  return { celebrate, celebrating, celebrationProps }
}

function getCelebrationAnimation(style: CelebrationStyle): CelebrationProps {
  switch (style) {
    case 'checkmark':
      return {
        animate: { scale: [1, 1.05, 1], opacity: [0.8, 1, 1] },
        transition: { duration: 0.4, ease: 'easeOut' }
      }
    case 'pulse':
      return {
        animate: { scale: [1, 1.08, 1] },
        transition: springs.bouncy
      }
    case 'ripple':
      return {
        animate: { scale: [1, 1.03, 1], opacity: [1, 0.9, 1] },
        transition: { duration: 0.5, ease: 'easeOut' }
      }
  }
}
```

- [ ] **Step 2: Update barrel export**

Add to `src/renderer/lib/motion/index.ts`:

```ts
// Add these lines (hooks are in hooks/ not lib/motion/, so no change to barrel needed)
// The hooks import from @renderer/lib/motion already — they're consumed directly
```

Actually, the hooks live in `src/renderer/hooks/` and are imported directly by components. No barrel change needed.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/useCompletionCelebration.ts
git commit -m "$(cat <<'EOF'
feat: add useCompletionCelebration hook with checkmark, pulse, ripple styles
EOF
)"
```

---

## Task 15: Wire Capture Theater into Status UI

**Files:**
- Modify: `src/renderer/components/status/CaptureHealth.tsx`

This connects the `useTheater` hook to the capture ingestion flow visible in the CaptureHealth dropdown. When a new capture event comes in, it shows staged progress instead of instant appearance.

- [ ] **Step 1: Add theater to CaptureHealth event display**

In `src/renderer/components/status/CaptureHealth.tsx`, for new capture events in the event list, wrap each `EventRow` appearance with Motion's `AnimatePresence` and `presets.listItem` for staggered entry:

```tsx
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion'

// In the events list rendering:
<AnimatePresence>
  {events.map((event, i) => (
    <motion.div
      key={event.id ?? i}
      {...presets.listItem}
    >
      <EventRow event={event} />
    </motion.div>
  ))}
</AnimatePresence>
```

The full theater integration (useTheater with staged progress for individual captures) will be wired when the capture pipeline has progress events. For now, the event list entries stagger in to give visual feedback.

- [ ] **Step 2: Test capture event animation**

Run: `pnpm dev`

Trigger captures and observe the CaptureHealth dropdown. Expected: New events animate in with a slide-from-left spring.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/status/CaptureHealth.tsx
git commit -m "$(cat <<'EOF'
feat: add staggered animation to capture health event list
EOF
)"
```

---

## Task 16: Animate NewCaseWizard

**Files:**
- Modify: `src/renderer/components/cases/NewCaseWizard.tsx`

- [ ] **Step 1: Add Motion to wizard form sections**

In `src/renderer/components/cases/NewCaseWizard.tsx`:

1. Add imports:
```tsx
import { motion } from 'motion/react'
import { presets } from '@renderer/lib/motion'
```

2. Wrap the main form card content in a staggered motion container:
```tsx
<motion.div
  initial="hidden"
  animate="visible"
  variants={{
    hidden: {},
    visible: { transition: { staggerChildren: 0.06 } }
  }}
>
  {/* Wrap each form section in a motion.div with fadeUp variants */}
  <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
    {/* Case name section */}
  </motion.div>
  <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
    {/* Description section */}
  </motion.div>
  {/* etc. */}
</motion.div>
```

3. For the case type selection buttons, add a subtle `whileTap={{ scale: 0.97 }}` and `whileHover={{ scale: 1.02 }}`:
```tsx
<motion.button
  whileTap={{ scale: 0.97 }}
  whileHover={{ scale: 1.02 }}
  className="..."
>
  {/* type option content */}
</motion.button>
```

- [ ] **Step 2: Test wizard animations**

Run: `pnpm dev`

Navigate to create a new case. Expected: Form sections stagger in. Type buttons have spring feedback on hover/tap.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/cases/NewCaseWizard.tsx
git commit -m "$(cat <<'EOF'
feat: add staggered entrance and interaction animations to NewCaseWizard
EOF
)"
```

---

## Task 17: Animate Export Dialog with Theater

**Files:**
- Modify: `src/renderer/components/export/ExportDialog.tsx`

- [ ] **Step 1: Wire useTheater into export progress**

In `src/renderer/components/export/ExportDialog.tsx`:

1. Add imports:
```tsx
import { motion, AnimatePresence } from 'motion/react'
import { useTheater } from '@renderer/hooks/useTheater'
import { useCompletionCelebration } from '@renderer/hooks/useCompletionCelebration'
import { presets } from '@renderer/lib/motion'
```

2. Replace the simple `progress` string state with `useTheater`:
```tsx
const theater = useTheater({
  stages: ['Preparing report...', 'Packaging captures...', 'Writing file...'],
  minDuration: 800,
  done: exportComplete
})

const { celebrate, celebrating, celebrationProps } = useCompletionCelebration({ style: 'ripple' })
```

3. Add a `const [exportComplete, setExportComplete] = useState(false)` flag.

4. In the `handleExport` function, set `setExportComplete(true)` when done, and call `celebrate()`.

5. In the progress display area, show `theater.stage` instead of the raw progress string:
```tsx
{exporting && (
  <AnimatePresence mode="wait">
    <motion.div
      key={theater.stage}
      {...presets.fadeIn}
      className="mt-3 text-center text-xs text-text-muted"
    >
      {theater.isComplete ? (
        <motion.span {...celebrationProps} className="text-emerald-500 font-medium">
          Export complete!
        </motion.span>
      ) : (
        theater.stage
      )}
    </motion.div>
  </AnimatePresence>
)}
```

- [ ] **Step 2: Test export theater**

Run: `pnpm dev`

Export a case. Expected: Staged progress messages cycle through with spring fades. On completion, "Export complete!" appears with a ripple celebration animation.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/export/ExportDialog.tsx
git commit -m "$(cat <<'EOF'
feat: add theater-paced export progress with ripple completion celebration
EOF
)"
```

---

## Task 18: Run Full Test Suite & Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `pnpm test`

Expected: All tests pass. No regressions from animation changes.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: No lint errors.

- [ ] **Step 3: Run build**

Run: `pnpm build`

Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`

Test each animated surface:
1. Dashboard loads with staggered hero + card animations
2. Create case dialog opens/closes with spring animation
3. Route transitions fade between pages
4. Case workspace tabs slide indicator + content crossfade
5. Capture list items stagger in
6. CaptureHealth dropdown animates open/close
7. Connection status dot pulses
8. New case wizard form sections stagger
9. Export dialog shows staged theater progress

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -u
git commit -m "$(cat <<'EOF'
chore: final animation system cleanup and verification
EOF
)"
```
