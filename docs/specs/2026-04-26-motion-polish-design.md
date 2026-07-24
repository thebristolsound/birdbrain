# Motion Polish — Design

**Date:** 2026-04-26
**Status:** Approved (brainstorming complete)
**Inspiration:** T3 Chat (t3.chat) — restrained, native-feeling motion

## Goal

Make Birdbrain feel native and smooth by tightening the existing motion system in three layers: tactile micro-interactions, content reveals, and loading/state transitions. Motion should be whisper-quiet — the kind a user only notices if it were missing.

## Non-goals

- Route/view transitions between TanStack Router routes (deferred — separate work).
- Expressive flourishes (parallax, large springs, celebrations beyond what `useCompletionCelebration` already does).
- Adding a new animation library. The existing `motion` v12 system is sufficient.

## Existing baseline

The project already ships a well-formed motion system:

- `motion` v12.38.0 installed (Framer Motion's successor).
- `src/renderer/lib/motion/` exports `springs` (snappy/gentle/bouncy/molasses), `presets` (fadeUp/fadeIn/scaleIn/modal/overlay/slidePanel/listItem/stagger/popover/collapse), `MotionProvider`, and timing constants.
- `MotionProvider` wraps the renderer with `reducedMotion="user"` (respects OS preference).
- Hooks: `useCompletionCelebration`, `useStagedReveal`.
- `useTheme` already prevents transition flash on theme toggle via a `no-transitions` class.

Gaps:

- No tactile press primitive — buttons snap.
- No card hover lift convention.
- High-traffic lists (captures, cases, notes) snap on add/remove.
- Skeleton → content swaps snap.
- `AppearanceConfig.tsx` ships a "Reduce motion" toggle that is currently a disabled stub (lines 45–53).
- Several components use raw inline transitions instead of the preset system (`CaseHeader.tsx:139`, `OnboardingWizard.tsx:52,55`).
- Several `transition-all` usages should be narrower (`transition-colors` / `transition-transform`).

## Design

### 1. Motion language additions

`src/renderer/lib/motion/`:

- **`springs.ts`** — add two springs:
  - `microTap`: `{ stiffness: 600, damping: 28 }` — for press-down on buttons.
  - `hover`: `{ stiffness: 350, damping: 32 }` — for card lift on hover.
  - Existing `snappy` / `gentle` / `bouncy` / `molasses` unchanged.
- **`constants.ts`** — add named duration tokens for reference:
  - `DURATION_INSTANT = 80`
  - `DURATION_FAST = 120`
  - `DURATION_BASE = 180`
  - These are reference values for CSS-side transitions; they are not codegen'd into Tailwind.
- **`presets.ts`** — add three new presets keyed for `whileHover` / `whileTap`:
  - `tap`: `{ whileTap: { scale: 0.97 }, transition: springs.microTap }`
  - `hoverLift`: `{ whileHover: { y: -1 }, transition: springs.hover }`
  - `cardHover`: `{ whileHover: { y: -2 }, transition: springs.hover }`
- **`index.ts`** — re-export the new springs/presets so consumers import via `@renderer/lib/motion`.

### 2. Tactile primitives

`src/renderer/components/ui/`:

1. **`button.tsx`** — apply a `whileTap={{ scale: 0.97 }}` micro-press using `springs.microTap`. Implementation note: shadcn's `Button` uses `asChild` + Radix `Slot`. The cleanest path is to wrap children in a `motion.span` with the press animation rather than swap the button element itself, to preserve `Slot` semantics. Skip the animation when `disabled` or when `useReduceMotion()` returns `true`. Existing `transition-colors` class stays (handles color crossfade).
2. **`card.tsx`** — add an opt-in `interactive` prop. When set, applies `whileHover` from `presets.cardHover`. Default behavior unchanged so the ~38 existing card consumers are unaffected.

### 3. Sweep targets

Eliminate inconsistencies with the preset system:

- **`src/renderer/components/layout/CaseHeader.tsx:139`** — replace inline `transition: 'transform 200ms ease'` with a typed motion transition or route through an existing preset.
- **`src/renderer/components/layout/OnboardingWizard.tsx:52,55`** — leave the `transition-all duration-300` on the dot indicator (route-level intro context), but narrow `transition-all` to `transition-[width,background-color]` to avoid surprise property animations.
- **`src/renderer/hooks/useTheme.ts:28-36`** — no change. The `no-transitions` flash-prevention is correct.
- **`src/renderer/components/dashboard/HeroSection.tsx:29,36`**, **`RecentCases.tsx:50`**, **`CaseCard.tsx:164`** — change `transition-all` to the specific properties being animated (`transition-colors`, `transition-transform`, `transition-opacity`).

### 4. List & content reveals (AnimatePresence)

Three high-traffic surfaces, all using existing `presets.listItem`:

1. **`CaptureList.tsx`** — wrap items in `<AnimatePresence mode="popLayout">`. Animate add/remove with `presets.listItem`. Stagger only on initial mount (use a ref-based first-paint flag), not on subsequent updates.
2. **`RecentCases.tsx`** — stagger initial card grid mount with `presets.stagger` + `presets.fadeUp` per child.
3. **`NotesOverview.tsx`** — wrap note cards in `<AnimatePresence>` for create/delete.

Cap visible-on-mount stagger at 8 items. Add `STAGGER_VISIBLE_CAP = 8` to `constants.ts` (existing `STAGGER_CAP = 20` stays for other uses).

### 5. Loading & state transitions

1. **Skeleton → content crossfade.** In `CaptureList`, `Dashboard`, and `NotesOverview`, wrap the skeleton + content swap in `<AnimatePresence mode="wait">` with `presets.fadeIn` (~120ms). Removes the snap when data arrives.
2. **Spinner → result crossfade.** Same pattern in `AIConfig.tsx:88,121` and `AnalysisTab.tsx:206` for `Loader2.animate-spin` → result UI.
3. **`TopBar` capture pulse / `CaptureHealth`** — already animated. Leave alone.

### 6. Reduce-motion wiring

End-to-end wire-up for the currently-dead `AppearanceConfig` toggle:

1. **`src/shared/types.ts`** — `Settings` interface: add `reduceMotion: boolean` (default `false`). Missing key migrates to `false`.
2. **IPC** — uses existing `settings:get` / `settings:set` channels. No new channels needed.
3. **`src/renderer/hooks/useReduceMotion.ts`** (new) — returns a single `boolean`. Reads:
   - OS preference via `window.matchMedia('(prefers-reduced-motion: reduce)')`, listening for changes.
   - The persisted `reduceMotion` setting via React Query.
   - Returns `osPref || setting`.
4. **`src/renderer/lib/motion/provider.tsx`** — `MotionProvider` switches `reducedMotion` from `"user"` to `useReduceMotion() ? "always" : "user"`. `motion`'s `"always"` mode zeroes out all animations regardless of OS pref, so user opt-in works even on systems without the OS setting.
5. **`src/renderer/styles/globals.css`** — add a `html.reduce-motion *, html.reduce-motion *::before, html.reduce-motion *::after { transition-duration: 0ms !important; animation-duration: 0ms !important; }` rule. Toggle the `reduce-motion` class on `<html>` from `useReduceMotion`. Covers Tailwind `transition-colors` etc. that bypass `motion`.
6. **`src/renderer/components/settings/AppearanceConfig.tsx`** — replace the disabled stub (lines 45–53) with a working switch backed by `settings.reduceMotion`.

### 7. Testing strategy

- **Unit (Vitest):**
  - `useReduceMotion` returns `true` when (a) the setting is on, (b) OS pref matches, (c) both. Mock `matchMedia`.
  - New `tap` / `hoverLift` / `cardHover` presets each have the expected shape (`whileTap` or `whileHover` defined, `transition` defined).
- **E2E (Playwright):** one new test that opens settings, toggles "Reduce motion", and asserts a known animated element has zero animation duration. Optional — drop if flaky.
- **Manual:** a short README at `docs/motion-polish-checklist.md` listing the seven surfaces touched with before/after notes for hand-test.
- No visual regression infra exists. Not introducing it for this work.

## File inventory

**New (3):**

- `src/renderer/hooks/useReduceMotion.ts`
- `tests/useReduceMotion.test.ts`
- `docs/motion-polish-checklist.md` (manual test notes)

**Modified (18):**

- `src/renderer/lib/motion/springs.ts`
- `src/renderer/lib/motion/constants.ts`
- `src/renderer/lib/motion/presets.ts`
- `src/renderer/lib/motion/provider.tsx`
- `src/renderer/lib/motion/index.ts`
- `src/renderer/components/ui/button.tsx`
- `src/renderer/components/ui/card.tsx`
- `src/renderer/components/captures/CaptureList.tsx`
- `src/renderer/components/captures/AnalysisTab.tsx`
- `src/renderer/components/dashboard/RecentCases.tsx`
- `src/renderer/components/dashboard/HeroSection.tsx`
- `src/renderer/components/dashboard/CaseCard.tsx`
- `src/renderer/components/notes/NotesOverview.tsx`
- `src/renderer/components/settings/AppearanceConfig.tsx`
- `src/renderer/components/layout/CaseHeader.tsx`
- `src/renderer/components/layout/OnboardingWizard.tsx`
- `src/shared/types.ts`
- `src/renderer/styles/globals.css`

## Risks and open questions

- **`motion.button` + `asChild`.** Radix `Slot` composition with motion components has a known pattern; verified at implementation time. Fallback: wrap children in a `motion.span` and animate via the inner span (does not change layout).
- **`mode="popLayout"` keys.** Requires stable keys on list items. `CaptureList` uses capture IDs — should be safe. Confirm at implementation time.
- **CSS `!important` in globals.css.** Only used inside the `html.reduce-motion *` selector. Necessary because Tailwind utilities apply transitions inline-equivalently. Scoped narrowly so it does not affect normal use.
- **Existing settings migration.** Adding `reduceMotion` to `Settings` should not require a new DB migration — settings are stored as JSON and missing keys default to `false` in the read path. Confirm `src/main/services/settings.ts` follows this pattern at implementation time.

## Out of scope (future work)

- Route/view transition layer (TanStack Router transitions).
- Page-level scroll-triggered animations.
- A formal "motion language" doc beyond this spec.
- Lint rules to enforce preset usage over raw `transition-all`.
