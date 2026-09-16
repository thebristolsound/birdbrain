# Design system patch — v2

Target: `thebristolsound/birdbrain@main` (tree `37dbf57`, verified 2026-08-11).
Applying this and republishing `birdbrain-ui` syncs the design-system package —
it is generated from these same files.

**v2 supersedes the 2026-08-07 patch**, which prescribed a 4/6/8/12/16 radius
scale and 32px default controls. That patch was measured before the prototype's
standardization + sweep passes settled the final system (radii 2/4/6, one 28px
control metric) and was rejected in engineering review as stale. Do not apply v1.

---

## 1. `src/renderer/styles/globals.css`

### 1a. Radius — collapse the scale to 2 / 4 / 6
```diff
   /* Radius system */
-  --radius: 0.5rem;
-  --radius-sm: calc(var(--radius) - 4px);   /* 4px */
-  --radius-md: calc(var(--radius) - 2px);   /* 6px */
-  --radius-lg: var(--radius);               /* 8px */
-  --radius-xl: calc(var(--radius) + 4px);   /* 12px */
-  --radius-2xl: 0.75rem;                    /* 12px — same as xl */
+  --radius: 0.375rem;                       /* 6px — the ceiling */
+  --radius-sm: 2px;                         /* bars, checkboxes, thumbnails */
+  --radius-md: 4px;                         /* buttons, inputs, chips, tabs */
+  --radius-lg: var(--radius);               /* 6px — cards, panels, menus, dialogs, toasts */
+  --radius-xl: var(--radius);               /* collapsed to 6px */
+  --radius-2xl: var(--radius);              /* collapsed to 6px */
```
Aliasing `xl`/`2xl` down to 6px is deliberate: every existing `rounded-xl` /
`rounded-2xl` call site (Card, Dialog, hero CTA, icon tiles) collapses to the
6px ceiling in one token change, no sweep required. `rounded-full` remains legal
only for status pills and dots.

### 1b. Status surfaces — add to `@theme`
Replaces the ad-hoc `rgba(16,185,129,.1)` / `rgba(239,68,68,.2)` literals.
```css
  --color-success-surface: rgba(16,185,129,0.10);
  --color-success-line:    rgba(16,185,129,0.20);
  --color-success-fg:      #10b981;

  --color-danger-surface:  rgba(239,68,68,0.10);
  --color-danger-line:     rgba(239,68,68,0.20);
  --color-danger-fg:       #ef4444;

  --color-warning-surface: rgba(245,158,11,0.10);
  --color-warning-line:    rgba(245,158,11,0.20);
  --color-warning-fg:      #f59e0b;
```
Dark overrides — foregrounds lift one step for contrast on `#090a0b`:
```css
html.dark {
  --color-success-fg: #34d399;
  --color-danger-fg:  #f87171;
  --color-warning-fg: #fbbf24;
}
```

### 1c. Tracking
```css
@theme {
  --tracking-display: -0.025em;  /* every font-display heading */
  --tracking-label:    0.06em;   /* section-label eyebrows */
}
```
No new shadows. The v1 patch's `--shadow-accent` hero glow is **dropped** — the
sweep pass removed glow shadows; the hero CTA is flat (see §2a).

### 1d. Section-label utility
~18 hand-rolled copies across 11 files collapse to this. Also exposed as a
component (§2f) — use the component in TSX, the class where you only have a DOM node.
```css
.section-label {
  font-family: var(--font-display);
  font-size: 0.625rem;          /* 10px */
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--color-text-faint);
  line-height: 1;
}
.section-label-strong { color: var(--color-text-secondary); font-size: 0.6875rem; } /* 11px */
```

---

## 2. `src/renderer/components/ui/`

### 2a. `button.tsx` — one 28px metric
The base class already reads `rounded-md`, which §1a moves to 4px — no base change.
```diff
       size: {
-        xs: 'h-7 px-2 text-xs',
-        sm: 'h-8 px-3 text-sm',
-        default: 'h-9 px-4 text-sm',
-        lg: 'h-10 px-6 text-base',
-        icon: 'h-9 w-9',
-        'icon-sm': 'h-7 w-7'
+        xs: 'h-7 px-[11px] text-xs',        /* = sm; kept for API compat */
+        sm: 'h-7 px-[11px] text-xs',        /* THE control: 28px / 4px / 0 11px / 12px 500 */
+        default: 'h-7 px-[11px] text-xs',   /* 36px is retired — aliased down */
+        lg: 'h-9 px-5 text-sm rounded-lg',  /* dashboard hero CTA only: 36px / 6px, flat */
+        icon: 'h-7 w-7',
+        'icon-sm': 'h-6 w-6'
```
**Every size except `lg` resolves to the same 28px metric.** That is the point:
the prototype's final system has one control size; aliasing means untouched call
sites converge without a sweep. `sm` moving 14px → 12px text is the one
breaking-ish change — if a call site needs 14px, pass `className="text-sm"`.
No `hero` variant: the dashboard CTA is `size="lg"` with the default variant,
flat — glow shadows do not exist in the final system.

### 2b. `badge.tsx` — status variants + dot + pill metric
```diff
       variant: {
         default: 'border-transparent bg-accent text-white',
         secondary: 'border-transparent bg-elevated text-text-muted',
         outline: 'border-border text-text-secondary',
-        accent: 'border-transparent bg-accent-subtle text-accent'
+        accent: 'border-transparent bg-accent-subtle text-accent',
+        success: 'border-success-line bg-success-surface text-success-fg',
+        danger:  'border-danger-line  bg-danger-surface  text-danger-fg',
+        warning: 'border-warning-line bg-warning-surface text-warning-fg'
       },
       size: {
         sm: 'px-2 py-0.5 font-mono',
-        default: 'px-2.5 py-0.5'
+        default: 'px-2.5 py-0.5',
+        pill: 'h-7 px-2.5 gap-1.5 text-xs'   /* 28px status pill — TopBar "Connected" */
```
Optional leading dot — the prototype pairs one with every live-status pill:
```tsx
type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & { dot?: boolean; pulse?: boolean }

// inside render, before children:
{dot && (
  <span
    aria-hidden
    className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current', pulse && 'animate-pulse')}
  />
)}
```
Badge keeps `rounded-full` — status pills are the one sanctioned pill use.

### 2c. `card.tsx`
`Card` keeps its `rounded-2xl` class; §1a resolves it to 6px. Two changes:
```diff
-const CardTitle = ... 'text-lg font-semibold text-text-primary'
+const CardTitle = ... 'font-display text-xs font-semibold tracking-[-0.025em] text-text-primary'
```
Card titles are 12px in the final system (sweep pass: 13px → 12px). Where a
card's head is a true section label, prefer `<SectionLabel>` over `CardTitle`.

New nested-panel primitive — the recessed inner surface inside a card:
```tsx
const CardPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border-strong bg-surface p-3', className)}
      {...props}
    />
  )
)
```
Inversion from `Card`: nested panels use the **stronger** border on the
**dimmer** surface, so they read as recessed inside their parent.
`CardHeader`/`CardContent`/`CardFooter` padding (`p-5`) is unchanged.

### 2d. `input.tsx` / `textarea.tsx` — recess, one size
```diff
-'w-full rounded-lg border border-border-strong bg-elevated px-3 py-2 text-sm ...'
+'w-full rounded-md border border-border-strong bg-canvas px-2.5 py-1.5 text-xs ...'
```
The recess is the **fill**, not the border: `bg-canvas` (the darkest surface)
with `border-border-strong` kept. 4px radius, `6px 10px` padding, 12px text —
the one input, everywhere. (v1 prescribed `border-border` here; the final
system keeps the strong border.) Bare fields living inside an already-bordered
row pass `className="border-none bg-transparent p-0"`. Mono-content fields
(selector entry, pattern textarea) add `font-mono`.

The one sanctioned exception: New-case wizard fields stay 14px / `px-3 py-2`
via `className` — user-authored prose, not UI chrome.

### 2e. `dialog.tsx`
Panel radius collapses to 6px via §1a. `DialogTitle` drops to 14px
(`text-sm font-semibold`) — 16px is off the 10/11/12/14/18 scale.

### 2f. NEW `section-label.tsx`
```tsx
import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

type SectionLabelProps = HTMLAttributes<HTMLDivElement> & { emphasis?: 'faint' | 'strong' }

const SectionLabel = forwardRef<HTMLDivElement, SectionLabelProps>(
  ({ className, emphasis = 'faint', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'font-display font-semibold uppercase leading-none tracking-[0.06em]',
        emphasis === 'strong'
          ? 'text-[11px] text-text-secondary'
          : 'text-[10px] text-text-faint',
        className
      )}
      {...props}
    />
  )
)
SectionLabel.displayName = 'SectionLabel'
export { SectionLabel }
```
Export from `ui/index.ts`.

---

## 3. Migration order
1. `globals.css` §1a — the radius collapse lands the bulk of the sweep for free.
   Visually check anything that leaned on 12/16px reading "soft" (dialogs, hero).
2. `section-label.tsx` + `card.tsx` `CardPanel` — additive.
3. `badge.tsx` — additive.
4. `button.tsx` — sweep call sites for the 14px→12px text change; anything that
   needs 14px passes `className="text-sm"`.
5. `input.tsx`/`textarea.tsx` recess — check the new-case wizard keeps its 14px
   exception, and settings forms read right at 12px.
6. `dialog.tsx` title size.
7. Replace hand-rolled uppercase-label spans with `<SectionLabel>` (~18 sites, 11 files).
8. Replace status-color literals with the §1b tokens.
9. Density custom properties (`--d-*`, three steps) ride on top of this patch —
   sequenced with it per engineering review item 15, spec in the prototype's
   `HANDOFF.md`.
