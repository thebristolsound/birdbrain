# Design system patch

**STATUS: REJECTED / SUPERSEDED**

This patch bundle is superseded by the later standardization described in the
bundle's top-level `README.md` and `SESSION_HISTORY.md`. The final token system
uses radii 2/4/6 only (not the 4/6/8/12/16 scale in this patch) and 28px
controls with 4px radius (not 32px controls). Do not apply this patch as-is.

---

## 1. `src/renderer/styles/globals.css`

### 1a. Radius — one value changes
```diff
   --radius: 0.5rem;
   --radius-sm: calc(var(--radius) - 4px);   /* 4px */
   --radius-md: calc(var(--radius) - 2px);   /* 6px */
   --radius-lg: var(--radius);               /* 8px */
   --radius-xl: calc(var(--radius) + 4px);   /* 12px */
-  --radius-2xl: 0.75rem;                    /* 12px — same as xl */
+  --radius-2xl: 1rem;                       /* 16px — top-level card radius */
```
`xl` and `2xl` were both 12px, so `rounded-2xl` was doing nothing distinct.
Card, Dialog and the hero CTA all read `rounded-2xl`, so they promote to 16px
together. Nested panels move to `rounded-xl` explicitly (see §2c).

### 1b. Status surfaces — add to `@theme`
Replaces the ad-hoc `rgba(16,185,129,.1)` / `rgba(239,68,68,.2)` literals scattered
through the prototype and the current screens.
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
Dark overrides — the foregrounds lift one step for contrast on `#090a0b`:
```css
html.dark {
  --color-success-fg: #34d399;
  --color-danger-fg:  #f87171;
  --color-warning-fg: #fbbf24;
}
```
Surface and line opacities are unchanged across themes; only `*-fg` shifts.

### 1c. Tracking + hero shadow
```css
@theme {
  --tracking-display: -0.025em;
  --tracking-label:    0.05em;
}
:root      { --shadow-accent: 0 10px 15px -3px rgba(99,102,241,0.40), 0 4px 6px -4px rgba(99,102,241,0.40); }
html.dark  { --shadow-accent: 0 10px 15px -3px rgba(100,103,242,0.30), 0 4px 6px -4px rgba(100,103,242,0.30); }
```

### 1d. Section-label utility
27 hand-rolled copies collapse to this. Also exposed as a component (§2f) — use the
component in TSX, the class where you only have a DOM node.
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

### 2a. `button.tsx`
```diff
       size: {
-        xs: 'h-7 px-2 text-xs',
-        sm: 'h-8 px-3 text-sm',
+        xs: 'h-7 px-2 text-xs',              /* 28px — dense toolbar action */
+        sm: 'h-8 px-3 text-xs',              /* 32px — THE default control */
         default: 'h-9 px-4 text-sm',
         lg: 'h-10 px-6 text-base',
-        icon: 'h-9 w-9',
-        'icon-sm': 'h-7 w-7'
+        icon: 'h-9 w-9 rounded-lg',
+        'icon-md': 'h-8 w-8 rounded-lg',     /* NEW — 32px square, the common one */
+        'icon-sm': 'h-7 w-7 rounded-md'
       }
```
**`sm` changing from `text-sm` to `text-xs` is the one breaking-ish change.** It is
deliberate: 32px/12px is the prototype's default control everywhere, and `sm` is the
most-used size in the app. If a specific call site needs 14px, pass `className="text-sm"`.

Add a hero variant for the dashboard primary CTA:
```diff
       variant: {
         default: 'bg-accent text-white shadow-[var(--shadow-btn)] hover:bg-accent-hover',
+        hero: 'bg-accent text-white font-display font-bold rounded-2xl px-7 py-4 text-sm shadow-[var(--shadow-accent)] hover:bg-accent-hover',
         destructive: 'bg-red-600 text-white hover:bg-red-700',
```
`outline` and `ghost` are already correct — `border-border-strong` on transparent,
hover to `bg-elevated`. No change.

### 2b. `badge.tsx` — status variants + dot
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
+        pill: 'h-7 px-2.5 gap-1.5 text-xs'   /* 28px status pill, e.g. "Extension connected" */
       }
```
Add an optional leading dot — the prototype pairs one with every live-status pill:
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
Dot is 6px, `bg-current` so it inherits the variant foreground. `pulse` is used only
for genuinely live states (extension connected, recording).

### 2c. `card.tsx`
`Card` keeps `rounded-2xl`; it becomes 16px via the token change. Two additions:
```diff
-const CardTitle = ... 'text-lg font-semibold text-text-primary'
+const CardTitle = ... 'font-display text-lg font-bold tracking-[-0.025em] text-text-primary'
```
New nested-panel primitive — the 12px inner surface inside a card (quick-start
illustrations, preview panes, grouped rows). 8 occurrences in the prototype:
```tsx
const CardPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl border border-border-strong bg-surface p-3', className)}
      {...props}
    />
  )
)
```
Note the inversion from `Card`: nested panels use the **stronger** border on the
**dimmer** surface, so they read as recessed inside their parent.

`CardHeader`/`CardContent`/`CardFooter` padding (`p-5` = 20px) already matches the
prototype. No change.

### 2d. `input.tsx` / `textarea.tsx` — recess + density
```diff
-'w-full rounded-lg border border-border-strong bg-elevated px-3 py-2 text-sm ...'
+'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm ...'
```
Plus a density variant (the prototype's fields are almost all compact):
```tsx
const inputVariants = cva(
  'w-full rounded-lg border border-border bg-canvas text-text-primary outline-none focus:border-accent placeholder:text-text-faint disabled:opacity-50',
  {
    variants: {
      density: {
        default: 'px-3 py-2 text-sm',
        compact: 'px-2.5 py-1.5 text-xs',   /* 12px — the prototype default */
      },
    },
    defaultVariants: { density: 'compact' },
  }
)
```
Bare fields (a search input living inside an already-bordered row) are not a variant —
pass `className="border-none bg-transparent p-0"` and let the row own the chrome.
Mono-content fields (selector entry, pattern textarea) add `font-mono`.

### 2e. `tabs.tsx`
No structural change. The Radix defaults already resolve correctly; only confirm
`TabsTrigger` uses `text-xs` in dense contexts via `className`.

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
        'font-display font-semibold uppercase leading-none tracking-[0.05em]',
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
1. `globals.css` (§1) — no visual regression risk except the 2xl radius promotion, which is intended.
2. `section-label.tsx` + `card.tsx` `CardPanel` — additive, nothing breaks.
3. `badge.tsx` — additive.
4. `button.tsx` `sm` text size — sweep call sites, add `className="text-sm"` where 14px was load-bearing.
5. `input.tsx` recess + compact default — check any full-width form (settings, new-case wizard) still reads right at 12px.
6. Replace hand-rolled uppercase-label spans with `<SectionLabel>` (27 sites).
7. Replace `rgba(16,185,129,…)` / `rgba(239,68,68,…)` literals with the status tokens.
