# Motion Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten Birdbrain's existing `motion/lib` system into a whisper-quiet T3-Chat-style motion layer covering tactile micro-interactions, list/content reveals, loading transitions, and a working "Reduce motion" toggle.

**Architecture:** Extend the existing `src/renderer/lib/motion/` system (springs, presets, MotionProvider) with two new springs and three new presets. Wrap a small set of UI primitives (`Button`, `Card`) for tactile feedback. Apply `AnimatePresence` to three high-traffic lists. Wire the dead "Reduce motion" toggle in `AppearanceConfig` end-to-end (settings type → IPC → hook → MotionProvider + CSS gate).

**Tech Stack:** `motion` v12 (Framer's successor), Tailwind v4 with custom semantic tokens, React 19, Zustand (UI state only — settings stay local), Vitest with `happy-dom` for hook tests, `@testing-library/react` `renderHook`. The companion `BirdbrainSettings` interface and `DEFAULT_SETTINGS` live in `src/shared/types.ts` and `src/main/services/settings.ts` respectively.

**Spec:** `docs/superpowers/specs/2026-04-26-motion-polish-design.md`

**Conventions used in this plan:**
- All code changes live in the renderer except the settings type (shared) and `DEFAULT_SETTINGS` (main).
- Commit format follows the project style: `<type>(<scope>): <subject>` — types are `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. Author is `Matt Donovan`.
- Per CLAUDE.md: never `git add -A` / `git add .`. Stage explicit paths.
- The `docs/superpowers/` directory is gitignored — the spec and this plan are not committed.

---

## Task 1: Add `microTap` and `hover` springs

**Files:**
- Modify: `src/renderer/lib/motion/springs.ts`
- Test: `tests/renderer/lib/motion/springs.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/lib/motion/springs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { springs } from '@renderer/lib/motion/springs'

describe('springs', () => {
  it('exposes existing springs', () => {
    expect(springs.snappy.type).toBe('spring')
    expect(springs.gentle.type).toBe('spring')
    expect(springs.bouncy.type).toBe('spring')
    expect(springs.molasses.type).toBe('spring')
  })

  it('exposes microTap spring (high stiffness for press feedback)', () => {
    expect(springs.microTap.type).toBe('spring')
    expect(springs.microTap.stiffness).toBe(600)
    expect(springs.microTap.damping).toBe(28)
  })

  it('exposes hover spring (medium stiffness for lift)', () => {
    expect(springs.hover.type).toBe('spring')
    expect(springs.hover.stiffness).toBe(350)
    expect(springs.hover.damping).toBe(32)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/renderer/lib/motion/springs.test.ts`
Expected: FAIL with `microTap` undefined.

- [ ] **Step 3: Add the two springs**

Replace the body of `src/renderer/lib/motion/springs.ts` with:

```typescript
import type { Transition } from 'motion/react'

export const springs = {
  snappy: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 30
  },
  gentle: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 24
  },
  bouncy: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 15
  },
  molasses: {
    type: 'spring' as const,
    stiffness: 120,
    damping: 20
  },
  microTap: {
    type: 'spring' as const,
    stiffness: 600,
    damping: 28
  },
  hover: {
    type: 'spring' as const,
    stiffness: 350,
    damping: 32
  }
} satisfies Record<string, Transition>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/renderer/lib/motion/springs.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/motion/springs.ts tests/renderer/lib/motion/springs.test.ts
git commit -m "feat(motion): add microTap and hover springs"
```

---

## Task 2: Add `tap`, `hoverLift`, `cardHover` presets and visible-stagger cap

**Files:**
- Modify: `src/renderer/lib/motion/presets.ts`
- Modify: `src/renderer/lib/motion/constants.ts`
- Modify: `src/renderer/lib/motion/index.ts`
- Test: `tests/renderer/lib/motion/presets.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/lib/motion/presets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { presets } from '@renderer/lib/motion/presets'

describe('presets', () => {
  it('exposes tap preset with whileTap and microTap-class transition', () => {
    expect(presets.tap.whileTap).toEqual({ scale: 0.97 })
    expect(presets.tap.transition.type).toBe('spring')
    expect(presets.tap.transition.stiffness).toBe(600)
  })

  it('exposes hoverLift preset', () => {
    expect(presets.hoverLift.whileHover).toEqual({ y: -1 })
    expect(presets.hoverLift.transition.type).toBe('spring')
  })

  it('exposes cardHover preset (slightly larger lift)', () => {
    expect(presets.cardHover.whileHover).toEqual({ y: -2 })
    expect(presets.cardHover.transition.type).toBe('spring')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/renderer/lib/motion/presets.test.ts`
Expected: FAIL with `presets.tap` undefined.

- [ ] **Step 3: Add `STAGGER_VISIBLE_CAP` constant**

Edit `src/renderer/lib/motion/constants.ts`. Add the new constant on a new line at the end:

```typescript
export const MIN_THEATER_MS = 800
export const MIN_STAGE_TIME_MS = 250
export const STAGGER_INTERVAL = 0.04
export const STAGGER_CAP = 20
export const STAGGER_VISIBLE_CAP = 8
export const CELEBRATION_HOLD_MS = 600
export const OVERLAY_DURATION = 0.2
```

- [ ] **Step 4: Add the three presets**

Append to `src/renderer/lib/motion/presets.ts` inside the `presets` object (preserve existing entries; add commas as needed). The final file:

```typescript
import type { TargetAndTransition, Transition } from 'motion/react'
import { springs } from './springs'
import { STAGGER_INTERVAL, OVERLAY_DURATION } from './constants'

function makePreset(
  initial: TargetAndTransition,
  animate: TargetAndTransition,
  transition: Transition,
  exit?: TargetAndTransition
) {
  return {
    initial,
    animate,
    exit: exit ?? initial,
    transition
  }
}

export const presets = {
  fadeUp: makePreset({ opacity: 0, y: 8 }, { opacity: 1, y: 0 }, springs.snappy),

  fadeIn: makePreset({ opacity: 0 }, { opacity: 1 }, springs.snappy),

  scaleIn: makePreset({ opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1 }, springs.snappy),

  modal: makePreset(
    { opacity: 0, scale: 0.96, y: 12 },
    { opacity: 1, scale: 1, y: 0 },
    springs.gentle
  ),

  overlay: makePreset({ opacity: 0 }, { opacity: 1 }, { duration: OVERLAY_DURATION }),

  slidePanel: makePreset({ opacity: 0, x: '100%' }, { opacity: 1, x: 0 }, springs.gentle, {
    opacity: 0,
    x: '100%'
  }),

  listItem: makePreset({ opacity: 0, x: -8 }, { opacity: 1, x: 0 }, springs.snappy),

  stagger: {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: STAGGER_INTERVAL
      }
    },
    exit: { opacity: 0 }
  },

  popover: makePreset(
    { opacity: 0, scale: 0.97, y: -4 },
    { opacity: 1, scale: 1, y: 0 },
    springs.snappy
  ),

  collapse: makePreset({ opacity: 0, height: 0 }, { opacity: 1, height: 'auto' }, springs.snappy),

  tap: {
    whileTap: { scale: 0.97 },
    transition: springs.microTap
  },

  hoverLift: {
    whileHover: { y: -1 },
    transition: springs.hover
  },

  cardHover: {
    whileHover: { y: -2 },
    transition: springs.hover
  }
} as const
```

- [ ] **Step 5: Re-export the new constant from index**

Edit `src/renderer/lib/motion/index.ts`:

```typescript
export { springs } from './springs'
export { presets } from './presets'
export { MotionProvider } from './provider'
export {
  MIN_THEATER_MS,
  MIN_STAGE_TIME_MS,
  STAGGER_INTERVAL,
  STAGGER_CAP,
  STAGGER_VISIBLE_CAP,
  CELEBRATION_HOLD_MS,
  OVERLAY_DURATION
} from './constants'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/renderer/lib/motion/`
Expected: PASS — 6 tests across `springs.test.ts` and `presets.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/motion/presets.ts src/renderer/lib/motion/constants.ts src/renderer/lib/motion/index.ts tests/renderer/lib/motion/presets.test.ts
git commit -m "feat(motion): add tap/hoverLift/cardHover presets and visible-stagger cap"
```

---

## Task 3: Add `reduceMotion` to settings type and defaults

**Files:**
- Modify: `src/shared/types.ts:56-70` (`BirdbrainSettings` interface)
- Modify: `src/main/services/settings.ts:43-57` (`DEFAULT_SETTINGS` constant)

- [ ] **Step 1: Add `reduceMotion: boolean` to the interface**

In `src/shared/types.ts`, locate the `BirdbrainSettings` interface and add the field after `theme`:

```typescript
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
}
```

- [ ] **Step 2: Add the default in DEFAULT_SETTINGS**

In `src/main/services/settings.ts`, update `DEFAULT_SETTINGS`:

```typescript
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
  analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT
}
```

- [ ] **Step 3: Verify typecheck and existing settings tests still pass**

Run: `pnpm tsc --noEmit && pnpm vitest run tests/main/services/settings`
Expected: PASS. (Settings load merges saved-on-disk values with `DEFAULT_SETTINGS` via `getSettings`, so missing `reduceMotion` defaults to `false` automatically — no DB migration needed.)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/services/settings.ts
git commit -m "feat(settings): add reduceMotion preference (default false)"
```

---

## Task 4: Create `useReduceMotion` hook

**Files:**
- Create: `src/renderer/hooks/useReduceMotion.ts`
- Test: `tests/renderer/hooks/useReduceMotion.test.ts` (new)

The hook reads two signals — the OS `prefers-reduced-motion` media query and a renderer-local `reduceMotion` flag (mirrored to `localStorage`, like `useTheme`) — and returns a single boolean OR of the two. The `AppearanceConfig` toggle (Task 7) writes both `localStorage` and the IPC settings, mirroring the `useTheme` pattern at `src/renderer/hooks/useTheme.ts:26-40`.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/hooks/useReduceMotion.test.ts`:

```typescript
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'

function setMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
    dispatch: (m: boolean) => {
      mql.matches = m
      listeners.forEach((l) => l({ matches: m } as MediaQueryListEvent))
    }
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return mql
}

describe('useReduceMotion', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('returns false when neither OS nor setting requests reduced motion', () => {
    setMatchMedia(false)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(false)
  })

  it('returns true when OS prefers reduced motion', () => {
    setMatchMedia(true)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(true)
  })

  it('returns true when localStorage reduceMotion is "true"', () => {
    setMatchMedia(false)
    localStorage.setItem('reduceMotion', 'true')
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(true)
  })

  it('updates when the OS preference changes', () => {
    const mql = setMatchMedia(false)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(false)
    act(() => mql.dispatch(true))
    expect(result.current).toBe(true)
  })

  it('updates when the storage setting changes via storage event', () => {
    setMatchMedia(false)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(false)
    act(() => {
      localStorage.setItem('reduceMotion', 'true')
      window.dispatchEvent(new StorageEvent('storage', { key: 'reduceMotion', newValue: 'true' }))
    })
    expect(result.current).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/renderer/hooks/useReduceMotion.test.ts`
Expected: FAIL — module `useReduceMotion` not found.

- [ ] **Step 3: Implement the hook**

Create `src/renderer/hooks/useReduceMotion.ts`:

```typescript
import { useEffect, useState } from 'react'

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const STORAGE_KEY = 'reduceMotion'

function readSettingFlag(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

function readOsPref(): boolean {
  return window.matchMedia(MEDIA_QUERY).matches
}

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() => readOsPref() || readSettingFlag())

  useEffect(() => {
    function recompute() {
      setReduce(readOsPref() || readSettingFlag())
    }

    const mql = window.matchMedia(MEDIA_QUERY)
    mql.addEventListener('change', recompute)

    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) recompute()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      mql.removeEventListener('change', recompute)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return reduce
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/renderer/hooks/useReduceMotion.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useReduceMotion.ts tests/renderer/hooks/useReduceMotion.test.ts
git commit -m "feat(motion): add useReduceMotion hook (OS pref + setting)"
```

---

## Task 5: Wire `useReduceMotion` into `MotionProvider`

**Files:**
- Modify: `src/renderer/lib/motion/provider.tsx`

- [ ] **Step 1: Update provider to consume the hook**

Replace the body of `src/renderer/lib/motion/provider.tsx` with:

```tsx
import { MotionConfig } from 'motion/react'
import { springs } from './springs'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import type { ReactNode } from 'react'

interface MotionProviderProps {
  children: ReactNode
}

export function MotionProvider({ children }: MotionProviderProps) {
  const reduce = useReduceMotion()
  return (
    <MotionConfig
      transition={springs.snappy}
      reducedMotion={reduce ? 'always' : 'user'}
    >
      {children}
    </MotionConfig>
  )
}
```

`reducedMotion="always"` zeroes all motion durations regardless of OS pref, so the in-app toggle works on systems without the OS setting.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Sanity-run the renderer**

Run: `pnpm dev`
Expected: app boots without errors. Close after verification.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/motion/provider.tsx
git commit -m "feat(motion): MotionProvider consumes useReduceMotion"
```

---

## Task 6: Add `.reduce-motion` CSS gate

**Files:**
- Modify: `src/renderer/styles/globals.css`

The CSS gate kills Tailwind/inline transitions that don't go through `motion`. The `useReduceMotion` hook (Task 5) doesn't toggle the class — that happens in Task 7 inside `AppearanceConfig` so the toggle and class apply together.

- [ ] **Step 1: Append the rule near the other global utility rules**

Append to `src/renderer/styles/globals.css` (place after the existing `html.dark` block ending around line 105):

```css
/* === Reduce motion: zero out transitions and animations when toggled === */
html.reduce-motion *,
html.reduce-motion *::before,
html.reduce-motion *::after {
  transition-duration: 0ms !important;
  animation-duration: 0ms !important;
  animation-iteration-count: 1 !important;
}
```

- [ ] **Step 2: Verify the rule is parsed**

Run: `pnpm dev`
Expected: app boots, no CSS warnings in the renderer console. Close after verification.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/globals.css
git commit -m "feat(motion): add reduce-motion CSS gate"
```

---

## Task 7: Wire the AppearanceConfig "Reduce motion" toggle

**Files:**
- Modify: `src/renderer/components/settings/AppearanceConfig.tsx`

Mirrors the `useTheme` pattern: the toggle writes to `localStorage` (so other tabs/hooks see it), persists via `window.birdbrain.settings.update`, and toggles the `reduce-motion` class on `<html>`.

- [ ] **Step 1: Replace the disabled stub**

Replace the body of `src/renderer/components/settings/AppearanceConfig.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { useTheme } from '@renderer/hooks/useTheme'
import { Card, CardContent, Label } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'

const STORAGE_KEY = 'reduceMotion'

function readInitial(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

function applyReduceMotionClass(enabled: boolean): void {
  document.documentElement.classList.toggle('reduce-motion', enabled)
}

export function AppearanceConfig() {
  const { theme, toggleTheme } = useTheme()
  const [reduce, setReduce] = useState<boolean>(readInitial)

  useEffect(() => {
    applyReduceMotionClass(reduce)
  }, [reduce])

  function handleToggle() {
    const next = !reduce
    setReduce(next)
    localStorage.setItem(STORAGE_KEY, String(next))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: String(next) }))
    window.birdbrain.settings.update({ reduceMotion: next })
  }

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Appearance</h2>
        <div className="space-y-4">
          <div>
            <Label className="mb-2">Theme</Label>
            <div className="flex gap-3">
              <button
                onClick={() => theme !== 'light' && toggleTheme()}
                className={cn(
                  'flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors',
                  theme === 'light'
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
                )}
              >
                Light
              </button>
              <button
                onClick={() => theme !== 'dark' && toggleTheme()}
                className={cn(
                  'flex-1 rounded-xl border-2 p-3 text-center text-sm font-medium transition-colors',
                  theme === 'dark'
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border-strong bg-card text-text-muted hover:border-accent/30'
                )}
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
              aria-checked={reduce}
              onClick={handleToggle}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                reduce ? 'bg-accent' : 'bg-text-faint'
              )}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  reduce ? 'translate-x-[18px]' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

Note: settings get-on-mount is intentionally omitted here — the `localStorage` mirror is the source of truth for the toggle state to avoid a flash of incorrect state on settings load. The IPC `update` keeps the on-disk setting in sync for cross-session persistence.

- [ ] **Step 2: Sanity-test the toggle in the running app**

Run: `pnpm dev`
1. Open Settings → Appearance.
2. Toggle "Reduce motion" on.
3. In renderer DevTools, confirm `<html>` has class `reduce-motion`.
4. Toggle off; confirm class is removed.
5. Reload the app; confirm the toggle remembers its state.

Close after verification.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/AppearanceConfig.tsx
git commit -m "feat(settings): wire reduce-motion toggle end-to-end"
```

---

## Task 8: Apply tactile press to `Button`

**Files:**
- Modify: `src/renderer/components/ui/button.tsx`

Switch the underlying element to `motion.button`, gate the press animation on `disabled`, and let `MotionProvider`'s `reducedMotion` setting handle the reduce-motion case (motion already does this when `reducedMotion="always"` — `whileTap` becomes a no-op).

- [ ] **Step 1: Replace the file**

Replace the body of `src/renderer/components/ui/button.tsx` with:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@renderer/lib/utils'
import { presets } from '@renderer/lib/motion'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white shadow-[var(--shadow-btn)] hover:bg-accent-hover',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline: 'border border-border-strong bg-transparent hover:bg-elevated text-text-primary',
        ghost: 'hover:bg-elevated text-text-muted hover:text-text-primary',
        link: 'text-accent underline-offset-4 hover:underline'
      },
      size: {
        xs: 'h-7 px-2 text-xs',
        sm: 'h-8 px-3 text-sm',
        default: 'h-9 px-4 text-sm',
        lg: 'h-10 px-6 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  keyof HTMLMotionProps<'button'>
>

type ButtonProps = NativeButtonProps &
  HTMLMotionProps<'button'> &
  VariantProps<typeof buttonVariants>

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, disabled, ...props }, ref) => (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileTap={disabled ? undefined : presets.tap.whileTap}
      transition={presets.tap.transition}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

- [ ] **Step 2: Verify typecheck and existing button consumers still compile**

Run: `pnpm tsc --noEmit`
Expected: PASS. (If any consumer relied on the bare `ButtonHTMLAttributes` event handler types and motion's typing diverges, fix the call site to satisfy `HTMLMotionProps<'button'>` — the two are largely compatible.)

- [ ] **Step 3: Visually verify in dev**

Run: `pnpm dev`. Click any primary button (e.g., "New Case"). Expect a subtle press scale-down (~3%). Toggle Reduce motion on; expect the press to disappear.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ui/button.tsx
git commit -m "feat(ui): tactile press scale on Button"
```

---

## Task 9: Add `interactive` prop to `Card`

**Files:**
- Modify: `src/renderer/components/ui/card.tsx`

Opt-in only — existing static cards stay untouched. Switch the root to `motion.div` so the prop can apply `whileHover` cleanly.

- [ ] **Step 1: Replace the file**

Replace the body of `src/renderer/components/ui/card.tsx` with:

```tsx
import { forwardRef, type HTMLAttributes } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@renderer/lib/utils'
import { presets } from '@renderer/lib/motion'

type NativeDivProps = Omit<HTMLAttributes<HTMLDivElement>, keyof HTMLMotionProps<'div'>>

type CardProps = NativeDivProps &
  HTMLMotionProps<'div'> & {
    hover?: boolean
    interactive?: boolean
  }

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, hover, interactive, ...props }, ref) => (
    <motion.div
      ref={ref}
      whileHover={interactive ? presets.cardHover.whileHover : undefined}
      transition={interactive ? presets.cardHover.transition : undefined}
      className={cn('neu-card rounded-2xl', hover && 'neu-card-hover', className)}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn('flex flex-col space-y-1.5 p-5 pb-0', className)} ref={ref} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 className={cn('text-lg font-semibold text-text-primary', className)} ref={ref} {...props} />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p className={cn('text-sm text-text-muted', className)} ref={ref} {...props} />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div className={cn('p-5', className)} ref={ref} {...props} />
)
CardContent.displayName = 'CardContent'

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn('flex items-center p-5 pt-0', className)} ref={ref} {...props} />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS — existing 38 consumers do not pass `interactive`, so behavior is unchanged for them.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ui/card.tsx
git commit -m "feat(ui): add interactive prop to Card with hover lift"
```

---

## Task 10: Add `AnimatePresence` + `listItem` to `CaptureList`

**Files:**
- Modify: `src/renderer/components/captures/CaptureList.tsx`

Stagger only on first paint. After that, items animate add/remove individually. Cap visible-on-mount stagger using `STAGGER_VISIBLE_CAP`.

- [ ] **Step 1: Update imports**

In `src/renderer/components/captures/CaptureList.tsx`, replace the imports block (lines 1-9) with:

```typescript
import { useState, useRef, useEffect } from 'react'
import { Search, ArrowUpDown, Filter, Crosshair, X, Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { capturesQueryOptions } from '@renderer/lib/queries'
import { Button, Skeleton } from '@renderer/components/ui'
import { presets, STAGGER_INTERVAL, STAGGER_VISIBLE_CAP } from '@renderer/lib/motion'
import { useAppStore } from '@renderer/stores/appStore'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { CaptureItem } from './CaptureItem'
import type { Capture } from '@shared/types'
```

- [ ] **Step 2: Track first-paint to gate the mount stagger**

Inside `CaptureList` (after the existing useState declarations, around line 91), add:

```typescript
  const firstPaintRef = useRef(true)
  useEffect(() => {
    firstPaintRef.current = false
  }, [])
```

- [ ] **Step 3: Wrap the list with `AnimatePresence` and `motion.div` items**

Replace the scrollable capture list block (currently lines 318-336) with:

```tsx
      {/* Scrollable capture list */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        <AnimatePresence mode="popLayout" initial={firstPaintRef.current}>
          {displayedCaptures.map((cap, i) => (
            <motion.div
              key={cap.id}
              layout
              initial={presets.listItem.initial}
              animate={presets.listItem.animate}
              exit={presets.listItem.exit}
              transition={{
                ...presets.listItem.transition,
                delay:
                  firstPaintRef.current && i < STAGGER_VISIBLE_CAP ? i * STAGGER_INTERVAL : 0
              }}
            >
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
            {filteredCaptureIds || activeFilterCount > 0
              ? 'No captures match the active filters'
              : 'No captures yet'}
          </div>
        )}
      </div>
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Visually verify**

Run: `pnpm dev`. Open a case with captures. Items fade-in left-to-right on mount; subsequent captures appear without re-staggering. Toggle Reduce motion; subsequent updates have no visible animation.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/captures/CaptureList.tsx
git commit -m "feat(captures): animate add/remove with AnimatePresence + listItem"
```

---

## Task 11: Stagger initial card mount in `RecentCases`

**Files:**
- Modify: `src/renderer/components/dashboard/RecentCases.tsx`

- [ ] **Step 1: Update imports and grid**

Replace the body of `src/renderer/components/dashboard/RecentCases.tsx` with:

```tsx
import { Plus } from 'lucide-react'
import { motion } from 'motion/react'
import type { Case } from '@shared/types'
import { presets, STAGGER_INTERVAL, STAGGER_VISIBLE_CAP } from '@renderer/lib/motion'
import { CaseCard } from './CaseCard'

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
        <div className="flex items-center gap-3 mb-6">
          <h2 className="font-display font-bold text-lg tracking-tight text-text-primary">
            Recent Cases
          </h2>
          <span className="rounded-full border border-border-strong bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-text-muted">
            {cases.length} {cases.length === 1 ? 'case' : 'cases'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {cases.slice(0, 3).map((c, i) => (
            <motion.div
              key={c.id}
              initial={presets.fadeUp.initial}
              animate={presets.fadeUp.animate}
              transition={{
                ...presets.fadeUp.transition,
                delay: i < STAGGER_VISIBLE_CAP ? i * STAGGER_INTERVAL : 0
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

          <div
            onClick={onNewCase}
            className="new-case-card cursor-pointer rounded-2xl border-2 border-dashed p-5 transition-colors flex flex-col items-center justify-center text-center min-h-[260px] group"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent-subtle transition-colors group-hover:bg-accent-subtle">
              <Plus className="h-6 w-6 text-accent transition-transform duration-300 group-hover:rotate-90" />
            </div>
            <h3 className="font-display font-bold text-sm text-accent mb-1">New Investigation</h3>
            <p className="text-[11px] text-accent leading-relaxed">
              Start a fresh case with
              <br />
              guided setup
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
```

Note: this also rolls in the sweep change for line 51 (`transition-all` → `transition-colors` on the new-case-card).

- [ ] **Step 2: Verify**

Run: `pnpm tsc --noEmit && pnpm dev`. On dashboard load, recent cases fade-up sequentially. Close after verification.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/dashboard/RecentCases.tsx
git commit -m "feat(dashboard): stagger recent case cards on mount"
```

---

## Task 12: AnimatePresence on `NotesOverview`

**Files:**
- Modify: `src/renderer/components/notes/NotesOverview.tsx`

- [ ] **Step 1: Update imports**

In `src/renderer/components/notes/NotesOverview.tsx`, replace the imports block (lines 1-8) with:

```typescript
import { useState, useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { Search } from 'lucide-react'
import { notesQueryOptions, notesSearchQueryOptions } from '@renderer/lib/queries'
import { Button } from '@renderer/components/ui'
import { presets } from '@renderer/lib/motion'
import { NoteCard } from './NoteCard'
import { CreateNoteCard } from './CreateNoteCard'
```

- [ ] **Step 2: Wrap the notes list**

Replace the notes list block (currently lines 100-104) with:

```tsx
        <div data-testid="notes-list" className="space-y-3">
          <AnimatePresence mode="popLayout">
            {notes.map((note) => (
              <motion.div
                key={note.id}
                layout
                initial={presets.listItem.initial}
                animate={presets.listItem.animate}
                exit={presets.listItem.exit}
                transition={presets.listItem.transition}
              >
                <NoteCard note={note} caseId={caseId} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
```

- [ ] **Step 3: Verify**

Run: `pnpm tsc --noEmit && pnpm dev`. Add and delete notes; expect smooth in/out. Existing E2E `data-testid="notes-list"` selector is preserved.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/notes/NotesOverview.tsx
git commit -m "feat(notes): animate note add/remove with AnimatePresence"
```

---

## Task 13: Skeleton-to-content crossfade in `CaptureList`

**Files:**
- Modify: `src/renderer/components/captures/CaptureList.tsx`

The skeleton block in `CaptureList` (currently around line 131) snaps to data when loading completes. Wrap it in an `AnimatePresence mode="wait"` with `presets.fadeIn`.

Scope note: the spec also mentioned Dashboard and NotesOverview, but verification showed Dashboard uses Skeleton only inside `CaseWorkspace.tsx` (a different surface) and NotesOverview uses text loading states (`"Loading notes..."`) rather than Skeleton. This task narrows to `CaptureList` only. Converting the others to Skeleton-based loading is a separate piece of work.

- [ ] **Step 1: Wrap the loading return**

Replace the loading block (currently lines 131-141) with:

```tsx
  if (isLoading) {
    return (
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-surface">
        <AnimatePresence mode="wait">
          <motion.div
            key="skeleton"
            className="space-y-2 p-4"
            initial={presets.fadeIn.initial}
            animate={presets.fadeIn.animate}
            exit={presets.fadeIn.exit}
            transition={presets.fadeIn.transition}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </motion.div>
        </AnimatePresence>
      </aside>
    )
  }
```

Note: the imports block already includes `motion`, `AnimatePresence`, and `presets` from Task 10 — no further import changes needed.

- [ ] **Step 2: Verify**

Run: `pnpm tsc --noEmit && pnpm dev`. Reload a case; skeleton fades out as data fades in. Close after verification.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/captures/CaptureList.tsx
git commit -m "feat(captures): crossfade skeleton to content on load"
```

---

## Task 14: Spinner-to-result crossfades (`AIConfig` and `AnalysisTab`)

**Files:**
- Modify: `src/renderer/components/settings/AIConfig.tsx` (Loader2 sites around lines 88 and 121)
- Modify: `src/renderer/components/captures/AnalysisTab.tsx` (loading state lines 204-211)

Look at each file first to see the surrounding structure before editing — only the spinner-and-result containers are in scope.

- [ ] **Step 1: Read the AIConfig spinner sites**

Run: `Get-Content src/renderer/components/settings/AIConfig.tsx | Select-Object -Index (79..134)`

- [ ] **Step 2: Wrap each AIConfig spinner-result container**

For each Loader2 site (around lines 88 and 121), wrap the conditional render with:

```tsx
<AnimatePresence mode="wait">
  {isLoading ? (
    <motion.div
      key="loading"
      initial={presets.fadeIn.initial}
      animate={presets.fadeIn.animate}
      exit={presets.fadeIn.exit}
      transition={presets.fadeIn.transition}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
    </motion.div>
  ) : (
    <motion.div
      key="result"
      initial={presets.fadeIn.initial}
      animate={presets.fadeIn.animate}
      exit={presets.fadeIn.exit}
      transition={presets.fadeIn.transition}
    >
      {/* existing result UI */}
    </motion.div>
  )}
</AnimatePresence>
```

Use the actual variable name from the surrounding code (likely `isLoading` or `isPending`) and preserve existing wrappers (`<div className="...">` etc.) inside the `motion.div` — keep classes intact.

Add the imports if not present:

```typescript
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion'
```

- [ ] **Step 3: Wrap the AnalysisTab loading state**

In `src/renderer/components/captures/AnalysisTab.tsx`, the analyzing-state early return (lines 203-211) currently snaps to results when `isAnalyzing` flips. Refactor that early return into an inline conditional under one parent `AnimatePresence`. Replace the loading-state `if` block plus the existing results `return` with a single render that crossfades. Concretely:

Replace:

```tsx
  // --- Loading state (analyzing) ---
  if (isAnalyzing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-xs text-text-muted">Analyzing capture...</p>
      </div>
    )
  }

  // --- Results state ---
  return (
    <div className="flex h-full flex-col">
      {/* ...existing results JSX... */}
    </div>
  )
```

With:

```tsx
  // --- Loading vs results: crossfade ---
  return (
    <AnimatePresence mode="wait">
      {isAnalyzing ? (
        <motion.div
          key="analyzing"
          className="flex h-full flex-col items-center justify-center gap-3 p-8"
          initial={presets.fadeIn.initial}
          animate={presets.fadeIn.animate}
          exit={presets.fadeIn.exit}
          transition={presets.fadeIn.transition}
        >
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-xs text-text-muted">Analyzing capture...</p>
        </motion.div>
      ) : (
        <motion.div
          key="results"
          className="flex h-full flex-col"
          initial={presets.fadeIn.initial}
          animate={presets.fadeIn.animate}
          exit={presets.fadeIn.exit}
          transition={presets.fadeIn.transition}
        >
          {/* ...existing results JSX, unchanged... */}
        </motion.div>
      )}
    </AnimatePresence>
  )
```

Important: leave the other early returns (loading models, error states around lines 149 and 195) alone — they handle different conditions and crossfading them all in one `AnimatePresence` would over-complicate the JSX. This task only swaps the analyzing→results transition.

Add the imports if not present:

```typescript
import { motion, AnimatePresence } from 'motion/react'
import { presets } from '@renderer/lib/motion'
```

- [ ] **Step 4: Verify**

Run: `pnpm tsc --noEmit && pnpm dev`. 
- Open Settings → AI; trigger model load. Expect a smooth fade between spinner and result.
- Open a capture and trigger AI analysis. Expect a smooth fade between the analyzing spinner and the results.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/AIConfig.tsx src/renderer/components/captures/AnalysisTab.tsx
git commit -m "feat(ai): crossfade spinner to result in AIConfig and AnalysisTab"
```

---

## Task 15: Sweep `CaseHeader` inline transition

**Files:**
- Modify: `src/renderer/components/layout/CaseHeader.tsx:135-143`

Replace the raw inline-style transition on the chevron with a `motion.span` rotation using the `snappy` spring.

- [ ] **Step 1: Replace the chevron block**

In `src/renderer/components/layout/CaseHeader.tsx`, locate the button containing `<ChevronDown>` (currently lines 130-143) and replace the inner `<ChevronDown ...>` with:

```tsx
          <motion.span
            animate={{ rotate: expanded ? 0 : -90 }}
            transition={springs.snappy}
            style={{ display: 'inline-flex' }}
          >
            <ChevronDown size={14} strokeWidth={2} />
          </motion.span>
```

Add the imports near the top of the file (alongside the other `motion`/lib imports if present, otherwise create the import lines):

```typescript
import { motion } from 'motion/react'
import { springs } from '@renderer/lib/motion'
```

If `motion` is already imported (the file imports `motion.div` for the collapse pattern at line 206), just add `springs` to the lib import.

- [ ] **Step 2: Verify**

Run: `pnpm tsc --noEmit && pnpm dev`. Toggle the case header expand/collapse; chevron rotation now uses the spring instead of a hardcoded ease.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/CaseHeader.tsx
git commit -m "refactor(layout): replace inline chevron transition with spring"
```

---

## Task 16: Narrow `transition-all` to specific properties

**Files:**
- Modify: `src/renderer/components/dashboard/HeroSection.tsx:29,36`
- Modify: `src/renderer/components/dashboard/CaseCard.tsx:164`
- Modify: `src/renderer/components/layout/OnboardingWizard.tsx:52,55`

`transition-all` triggers transitions on every property change. Narrow to the specific properties being animated to avoid surprise transitions on layout-affecting changes and reduce paint cost.

- [ ] **Step 1: HeroSection — `transition-all` → narrow**

In `src/renderer/components/dashboard/HeroSection.tsx`, find the two `transition-all active:scale-[0.98]` instances. Change each to `transition-[transform,box-shadow,background-color] active:scale-[0.98]`.

- [ ] **Step 2: CaseCard — narrow opacity reveal**

In `src/renderer/components/dashboard/CaseCard.tsx:164`, change `transition-all` to `transition-[opacity,background-color]`.

- [ ] **Step 3: OnboardingWizard — narrow dot indicator**

In `src/renderer/components/layout/OnboardingWizard.tsx:52,55`, change `transition-all duration-300` to `transition-[width,background-color] duration-300` on both indicator dots.

- [ ] **Step 4: Verify**

Run: `pnpm tsc --noEmit && pnpm dev`. Verify hero buttons, case cards, and onboarding dots animate as before — no visual regression.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/dashboard/HeroSection.tsx src/renderer/components/dashboard/CaseCard.tsx src/renderer/components/layout/OnboardingWizard.tsx
git commit -m "refactor(ui): narrow transition-all to specific properties"
```

---

## Task 17: Manual test checklist

**Files:**
- Create: `docs/motion-polish-checklist.md`

A short hand-test sheet for the seven surfaces touched. Lives outside `docs/superpowers/` so it can be committed.

- [ ] **Step 1: Write the checklist**

Create `docs/motion-polish-checklist.md`:

```markdown
# Motion polish — manual test checklist

Test each surface with **Reduce motion off** (default) and **Reduce motion on** (Settings → Appearance).

## Tactile

- [ ] **Button press.** Click any primary button (Dashboard "New Case", any modal "Save"). With reduce-motion off: subtle scale-down (~3%) on press. With reduce-motion on: no animation; native click only.
- [ ] **Disabled buttons.** A disabled button does not animate on click attempt.

## List & content reveals

- [ ] **CaptureList mount.** Open a case with 10+ captures. Items fade-in from left in a staggered cascade (capped at 8 items). Subsequent captures appear individually without re-staggering the whole list.
- [ ] **NotesOverview add/remove.** Add a note — it slides in. Delete a note — it slides out. List re-flows smoothly.
- [ ] **RecentCases mount.** Reload the dashboard with 3 cases — cards fade-up in sequence.

## Loading transitions

- [ ] **CaptureList skeleton.** Reload a case route. Skeleton placeholders fade out as the real list fades in (no snap).
- [ ] **AIConfig model load.** In Settings → AI, trigger a model list refresh. Spinner crossfades to the result list.

## Layout

- [ ] **CaseHeader chevron.** Expand/collapse the case header — chevron rotation uses a spring (slightly bouncy snap), not a linear ease.

## Reduce motion

- [ ] **Toggle persists.** Toggle on, reload the app, toggle is still on.
- [ ] **CSS gate active.** With reduce-motion on, `<html>` has the `reduce-motion` class. Tailwind `transition-colors` hover effects complete instantly.
- [ ] **OS preference respected.** Without the in-app toggle, set OS-level "Reduce motion" preference; all motion is suppressed via `MotionConfig reducedMotion="user"`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/motion-polish-checklist.md
git commit -m "docs(motion): add manual test checklist"
```

---

## Final verification

- [ ] **Step 1: Full typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS, no errors. (Per CLAUDE.md, do not run `--fix`. Hand-fix any reported issues.)

- [ ] **Step 3: Unit tests**

Run: `pnpm test`
Expected: PASS — all existing tests plus 3 new test files (`tests/renderer/lib/motion/springs.test.ts`, `tests/renderer/lib/motion/presets.test.ts`, `tests/renderer/hooks/useReduceMotion.test.ts`).

- [ ] **Step 4: E2E smoke**

Run: `pnpm test:e2e`
Expected: PASS — no regressions in existing flows. (No new E2E tests added; manual checklist covers motion surfaces.)

- [ ] **Step 5: Manual walk-through**

Run: `pnpm dev` and walk through `docs/motion-polish-checklist.md`. Every box ticks.

- [ ] **Step 6: Final review and PR**

If on a feature branch (recommended: `feat/motion-polish`), push and open a PR. Commit history should show 17 focused commits.

---

## Out of scope (do not implement here)

- Route/view transitions between TanStack Router routes — separate plan.
- A new motion language doc beyond the spec.
- ESLint rule enforcing preset usage over `transition-all`.
- Visual regression infra.
