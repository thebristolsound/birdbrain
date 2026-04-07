# Motion Animation System Design

**Date:** 2026-04-06
**Status:** Approved
**Approach:** Hybrid — Preset Variants + Composable Theater Hooks

## Overview

Standardized UI animation system for Birdbrain using Motion (fka Framer Motion). Replaces all existing CSS keyframe animations with a unified Motion-based system. Two-layer architecture: declarative presets for the common 80% of animations, and imperative theater hooks for orchestrated async operations with "illusion of labor" pacing.

### Design Goals

- **Snappy but fluid** — spring physics with decisive timing, not sluggish easing
- **Illusion of labor** — async operations feel like the system is doing meaningful work via staged reveals, minimum durations, and completion celebrations
- **Consistency** — every animation comes from a shared vocabulary of presets and springs
- **Progressive rollout** — 10 high-impact targets first, expand coverage based on feel
- **Reduced-motion ready** — architecture supports accessibility toggle but wiring deferred to a later pass

## Architecture

### File Structure

```
src/renderer/
  lib/motion/
    index.ts          — barrel export
    springs.ts        — named spring configs
    presets.ts        — reusable variant objects
    provider.tsx      — <MotionProvider> wrapping MotionConfig
    constants.ts      — timing constants (MIN_THEATER_MS, STAGGER_INTERVAL, etc.)
  hooks/
    useTheater.ts             — staged async operation orchestration
    useStagedReveal.ts        — staggered mount for lists/grids
    useCompletionCelebration.ts — success/failure terminal animations
```

### Two-Layer System

**Layer 1: Presets & Springs** — Declarative variant objects spread onto `motion.*` elements. Each preset contains `initial`, `animate`, `exit`, and `transition` properties. Components use them via `<motion.div {...presets.fadeUp}>`.

**Layer 2: Theater Hooks** — Imperative orchestration for async operations, staged reveals, and completion celebrations. Used for the theatrical 20% of animations that need runtime coordination.

### Provider

A thin `<MotionProvider>` wraps the app at the root level in `__root.tsx`:

```tsx
export function MotionProvider({ children }) {
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

- Global default spring: `springs.snappy`
- `reducedMotion="user"` respects OS preference out of the box
- No custom React context — just a thin MotionConfig wrapper

## Named Springs

Four spring configurations. Components never define their own spring values.

| Name | Stiffness | Damping | Character | Use Case |
|------|-----------|---------|-----------|----------|
| `snappy` | 400 | 30 | Quick, decisive, minimal overshoot | Default. Buttons, tabs, small UI shifts |
| `gentle` | 200 | 24 | Smooth, unhurried | Modals, overlays, page-level transitions |
| `bouncy` | 500 | 15 | Playful overshoot | Completion celebrations, success states |
| `molasses` | 120 | 20 | Deliberately slow | Theater pacing, loading shimmers |

## Preset Variants

Ten initial presets. Each is a spreadable object with `initial`, `animate`, `exit`, and `transition`.

| Preset | Animation | Spring | Use Case |
|--------|-----------|--------|----------|
| `fadeUp` | opacity 0→1, y 8→0 | snappy | General content entry, cards, sections |
| `fadeIn` | opacity 0→1 | snappy | Subtle reveals, status text, badges |
| `scaleIn` | opacity 0→1, scale 0.95→1 | snappy | Dashboard cards, tag badges, tooltips |
| `modal` | opacity 0→1, scale 0.96→1, y 12→0 | gentle | All modals and dialogs |
| `overlay` | opacity 0→1 | duration: 0.2s | Modal backdrops, overlay scrims |
| `slidePanel` | x 100%→0 (enter from right), opacity 0→1 | gentle | Route transitions, side panels, viewer. Exit reverses direction. |
| `listItem` | opacity 0→1, x -8→0 | snappy | Capture items, selector rows, note cards |
| `stagger` | parent variant with staggerChildren: 0.04s | — | Container for lists/grids using listItem children |
| `popover` | opacity 0→1, scale 0.97→1, y -4→0 | snappy | Dropdowns, context menus, health panel |
| `collapse` | height auto→0, opacity 1→0 | snappy | Expandable sections, accordion panels |

Every preset includes `exit` variants that reverse the entrance. Components wrapped in `<AnimatePresence>` get smooth exit animations for free.

## Theater Hooks

### useTheater

Turns a fast async operation into a staged visual experience with minimum pacing.

```ts
const { stage, progress, isComplete } = useTheater({
  stages: ['receiving', 'processing', 'verifying'],
  minDuration: 800,
  minStageTime: 250,
  done: captureComplete,
  actualProgress: uploadProgress,
})
```

**Behavior:**
- Advances through stages at a paced rate
- If `done` fires before `minDuration`, holds on the last stage until the timer elapses
- If `actualProgress` is provided, displayed progress blends real progress with theatrical pacing (never goes backwards)
- Returns `stage` as current stage name and `progress` as 0–1 float
- After final stage + minDuration, `isComplete` flips to true

### useStagedReveal

Orchestrates staggered mounting of a list of items with Motion's variant system.

```ts
const { containerProps, itemProps } = useStagedReveal({
  items: captures,
  staggerInterval: 0.04,
  preset: 'listItem',
})
```

**Behavior:**
- Returns `containerProps` to spread on the parent (sets up variant orchestration)
- Returns `itemProps` to spread on each child (inherits stagger timing from parent)
- Only triggers on mount or when items change — doesn't re-animate on re-renders
- Caps visible stagger to first ~20 items to avoid long waterfall delays

### useCompletionCelebration

Triggers a satisfying completion moment after an operation finishes.

```ts
const { celebrate, celebrationProps } = useCompletionCelebration({
  style: 'checkmark' | 'pulse' | 'ripple',
  holdDuration: 600,
})
```

**Celebration styles:**
- **checkmark** — SVG path draw-on animation. Best for: form submissions, successful saves.
- **pulse** — Element scales up slightly with a color-wash glow using `springs.bouncy`. Best for: status changes, capture complete.
- **ripple** — Expanding ring radiates outward from the element. Best for: export complete, batch operations.

**Usage:** Call `celebrate()` imperatively when operation succeeds. Spread `celebrationProps` on the target element. Animation plays once and cleans up.

### Reduced-Motion Readiness

All three hooks check an internal `shouldReduceMotion` flag (not wired to UI yet, but architecturally ready):
- `useTheater` — still shows stage labels but skips minimum duration hold
- `useStagedReveal` — reveals all items at once
- `useCompletionCelebration` — uses simple opacity flash instead of motion-heavy effects

## CSS Migration

All existing CSS keyframes and utility classes in `globals.css` are replaced by Motion equivalents. This is a clean swap.

| CSS to Remove | Motion Replacement |
|---------------|-------------------|
| `@keyframes fadeIn`, `.anim-in` | `presets.fadeIn` |
| `@keyframes fadeUp`, `.anim-up` | `presets.fadeUp` |
| `@keyframes scaleIn`, `.anim-scale` | `presets.scaleIn` |
| `.d1` through `.d9` (stagger delays) | `presets.stagger` + `useStagedReveal` |
| `@keyframes expandIn`, `.expand-panel` | `presets.collapse` |
| `@keyframes float, shimmer, pulse-ring, glow-pulse, softPulse` | Motion infinite animations via `repeat: Infinity` |

**Exception:** Theme transition CSS (`html.transitioning * { transition: ... }`) stays. It's a global class-toggle concern that doesn't benefit from Motion.

## Progressive Rollout — 10 Initial Targets

Ordered by visual impact and dependency. Each target is independent after #1.

### Phase 1: Foundation + High Visibility (1-5)

1. **MotionProvider + globals.css cleanup** — Install Motion. Create provider, springs, presets, constants. Remove CSS keyframes and utility classes. Wire provider into `__root.tsx`.

2. **Dashboard — HeroSection + CaseCards** — Replace `.anim-scale`/`.anim-up`/`.d1`-`.d5` with `presets.fadeUp` + `presets.scaleIn` + `useStagedReveal` on card grid.

3. **Modal & Dialog System** — `AnimatePresence` + `presets.modal` + `presets.overlay` on CreateCaseDialog, AddNoteModal, ExportDialog, BulkAddSelectorsModal. Entrance + exit animations.

4. **Route Transitions** — Wrap TanStack Router `<Outlet>` with `AnimatePresence` + `presets.fadeUp` for cross-route fades. Dashboard ↔ CaseWorkspace ↔ Settings.

5. **CaseWorkspace Tab Transitions** — Animated active-tab underline indicator (layout animation). Tab content crossfade using `AnimatePresence` on the nested `<Outlet>`.

### Phase 2: Core Workflow Depth (6-8)

6. **Capture List + Selection** — Staggered reveal on mount/filter changes via `useStagedReveal`. Smooth selection highlight transitions. Exit animations on item removal.

7. **Status Indicators & Dropdowns** — CaptureHealth dropdown: `presets.popover`. ConnectionStatus dot: Motion infinite pulse replacing `animate-pulse`. SessionControls recording indicator.

8. **Capture Theater** — Wire `useTheater` into capture ingestion flow. Staged progress: Receiving → Processing → Verifying → Complete with `useCompletionCelebration('pulse')`.

### Phase 3: Secondary Flow Polish (9-10)

9. **NewCaseWizard + Form Interactions** — Step transitions with `slidePanel`. Type selector buttons with `scaleIn` on select. Tag toggle animations. Completion celebration on case creation via `useCompletionCelebration('checkmark')`.

10. **Export Theater** — ExportDialog with `useTheater` staged progress (Preparing → Packaging → Writing). Completion celebration with ripple effect on success via `useCompletionCelebration('ripple')`.

## Timing Constants

```ts
// constants.ts
export const MIN_THEATER_MS = 800        // Minimum async operation display time
export const MIN_STAGE_TIME_MS = 250     // Minimum time per theater stage
export const STAGGER_INTERVAL = 0.04     // Seconds between staggered items
export const STAGGER_CAP = 20            // Max items that get stagger delay
export const CELEBRATION_HOLD_MS = 600   // How long completion animation holds
export const OVERLAY_DURATION = 0.2      // Backdrop fade duration (seconds)
```

## Dependencies

- `motion` (npm package, ~34KB min+gzip) — the only new dependency
- Imports from `motion/react` for React components and hooks
