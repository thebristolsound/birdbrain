# OpenRouter Theme Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin birdbrain to OpenRouter's flat zinc + `#6467f2` indigo visual language (light + dark), Inter type, 8px/6px radii, and bar-chart accent palette — without changing app structure.

**Architecture:** All color/radius/shadow/font changes flow through the central token system in `src/renderer/styles/globals.css`, so the ~82 components consuming semantic token classes reskin with no edits. Bespoke effects are neutralized in CSS (not deleted). A new `.neu-overlay` class gives floating panels a flat-but-raised look. The bar-chart palette ships as a typed constant consumed by `SourcesBlock`. Verification is build + Playwright/Electron screenshots of both themes.

**Tech Stack:** Tailwind CSS v4 (`@theme`), `@fontsource-variable/inter`, React 19, Vitest (unit), Playwright + Electron (e2e/screenshots).

## Global Constraints

- Code style: **no semicolons**, **single quotes**, **no trailing commas**, **100-char** width, **2-space** indent, TypeScript strict.
- Prefer semantic theme tokens over raw colors (exceptions: overlays `bg-black`, status/severity colors).
- Commits: Conventional Commits `<type>(<scope>): <subject>`. **Never** add `Co-authored-by`. Stage files **explicitly** (no `git add .` / `-A`).
- Accent is identical in both modes: `#6467f2`. Mono font stays JetBrains Mono.
- Do **not** touch `src/renderer/components/layout/export/ExportDialog.tsx` — it is unused/dead (the live export modal is `src/renderer/components/export/ExportDialog.tsx`). Flag it in the PR description; do not edit or delete it (out of scope).
- Branch: `feat/openrouter-theme` off a fast-forwarded `master`. The spec + ADR ship as a **separate** PR (tracked docs never bundle with `src`).

---

## Task 1: Core design tokens (colors, radius, shadows, Inter)

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/renderer/styles/globals.css:1-4` (font imports), `:85-87` (font tokens), `:7-26` (light tokens), `:78-82` (radius), `:91-105` (dark tokens), `:108-119` (shadow tokens)

**Interfaces:**
- Produces: the semantic token *values* every other task and component relies on. Token *names* are unchanged. New token `--shadow-overlay` (consumed by Task 4 via `.neu-overlay`). New `--radius-2xl: 0.75rem`.

- [ ] **Step 1: Swap font dependencies in `package.json`**

Remove these two `dependencies` lines:
```json
    "@fontsource-variable/dm-sans": "^5.2.8",
    "@fontsource-variable/plus-jakarta-sans": "^5.2.8",
```
Add (keep alphabetical-ish grouping with the other `@fontsource-variable/*`):
```json
    "@fontsource-variable/inter": "^5.2.8",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; `@fontsource-variable/inter` resolves; no errors.

- [ ] **Step 3: Replace font imports** in `src/renderer/styles/globals.css`

Replace lines 1-4:
```css
@import "tailwindcss";
@import "@fontsource-variable/plus-jakarta-sans";
@import "@fontsource-variable/dm-sans";
@import "@fontsource-variable/jetbrains-mono";
```
with:
```css
@import "tailwindcss";
@import "@fontsource-variable/inter";
@import "@fontsource-variable/jetbrains-mono";
```

- [ ] **Step 4: Point font tokens at Inter** (`globals.css:85-87`)

Replace:
```css
  --font-display: "Plus Jakarta Sans Variable", sans-serif;
  --font-body: "DM Sans Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
```
with:
```css
  --font-display: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
```

- [ ] **Step 5: Replace light-mode semantic tokens** (`globals.css:7-26`)

Replace the surface/text/accent/border blocks (the lines from `--color-canvas` through `--color-border-strong`) with:
```css
  /* Semantic surface tokens — light mode defaults (OpenRouter zinc) */
  --color-canvas: #fafafa;
  --color-surface: #f4f4f5;
  --color-card: #ffffff;
  --color-elevated: #ffffff;

  /* Semantic text tokens */
  --color-text-primary: #09090b;
  --color-text-secondary: #3f3f46;
  --color-text-muted: #71717a;
  --color-text-faint: #a1a1aa;

  /* Accent tokens */
  --color-accent: #6467f2;
  --color-accent-hover: #4f52e0;
  --color-accent-subtle: rgba(100,103,242,0.10);

  /* Border tokens */
  --color-border: #e4e4e7;
  --color-border-strong: #d4d4d8;
```
Leave the raw palette (`--color-indigo-*` … `--color-slate-*`) and the shadcn bridge tokens unchanged.

- [ ] **Step 6: Set radius scale** (`globals.css:78-82`)

Replace:
```css
  --radius: 0.75rem;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
```
with:
```css
  --radius: 0.5rem;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: 0.75rem;
```

- [ ] **Step 7: Replace dark-mode overrides** (`globals.css:91-105`)

Replace the body of `html.dark { … }` (the first one, the color block) with:
```css
html.dark {
  --color-canvas: #090a0b;
  --color-surface: #0e0e11;
  --color-card: #131316;
  --color-elevated: #1c1c20;
  --color-text-primary: #fafafa;
  --color-text-secondary: #d4d4d8;
  --color-text-muted: #a1a1aa;
  --color-text-faint: #71717a;
  --color-accent: #6467f2;
  --color-accent-hover: #7a7cf5;
  --color-accent-subtle: rgba(100,103,242,0.16);
  --color-border: #27272a;
  --color-border-strong: #3d3d42;
}
```

- [ ] **Step 8: Replace shadow tokens** (`globals.css:108-119`)

Replace both `:root` and `html.dark` shadow blocks with:
```css
:root {
  --shadow-card: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-card-hover: 0 1px 2px rgba(0,0,0,0.06);
  --shadow-overlay: 0 10px 30px rgba(0,0,0,0.12);
  --shadow-glow: none;
  --shadow-btn: none;
}
html.dark {
  --shadow-card: none;
  --shadow-card-hover: none;
  --shadow-overlay: 0 10px 30px rgba(0,0,0,0.5);
  --shadow-glow: none;
  --shadow-btn: none;
}
```

- [ ] **Step 9: Verify it builds**

Run: `pnpm build`
Expected: build succeeds, no missing-font or CSS errors.

- [ ] **Step 10: Verify lint**

Run: `pnpm lint`
Expected: passes (no changes to TS yet).

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/styles/globals.css
git commit -m "feat(theme): adopt OpenRouter color tokens, 8px radius, flat shadows, Inter"
```

---

## Task 2: Flatten bespoke effects + add `.neu-overlay`

**Files:**
- Modify: `src/renderer/styles/globals.css` — `body::after` (`:133-141`), `.neu-card` (`:169-173`), `.neu-card-hover:hover` (`:174-177`), `.glow-indigo`/`.glow-indigo-btn` (`:180-185`), `.shimmer-text` (+dark) (`:188-202`), `.logo-pulse` (+`::after`) (`:205-217`), `.grid-bg` (+dark) (`:220-233`), `.step-connector` (`:236-239`), `.new-case-card` (+hover/dark) (`:242-257`)

**Interfaces:**
- Produces: `.neu-overlay` (used by Task 4). `.neu-card` becomes flat. No JS interfaces.

> Note: this is CSS — there is no unit test. Verification is `pnpm build` + the Task 5 screenshots. Each step below gives the exact replacement.

- [ ] **Step 1: Remove the noise overlay** (`globals.css:133-141`)

Delete the entire `body::after { … }` rule.

- [ ] **Step 2: Flatten `.neu-card` and `.neu-card-hover`, add `.neu-overlay`** (`globals.css:169-177`)

Replace:
```css
.neu-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-card);
}
.neu-card-hover:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}
```
with:
```css
.neu-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  box-shadow: none;
}
.neu-card-hover:hover {
  border-color: var(--color-border-strong);
}
.neu-overlay {
  background: var(--color-elevated);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-overlay);
}
```

- [ ] **Step 3: Kill glows** (`globals.css:180-185`)

Replace:
```css
.glow-indigo {
  box-shadow: var(--shadow-glow);
}
.glow-indigo-btn {
  box-shadow: var(--shadow-btn);
}
```
with:
```css
.glow-indigo {
  box-shadow: none;
}
.glow-indigo-btn {
  box-shadow: none;
}
```

- [ ] **Step 4: Make `.shimmer-text` a solid accent** (`globals.css:188-202`)

Replace both the `.shimmer-text` rule and its `html.dark .shimmer-text` override with:
```css
.shimmer-text {
  color: var(--color-accent);
}
html.dark .shimmer-text {
  color: var(--color-accent);
}
```

- [ ] **Step 5: Make `.logo-pulse` static** (`globals.css:205-217`)

Replace:
```css
.logo-pulse {
  position: relative;
  animation: pulse 3s ease-in-out infinite, float 4s ease-in-out infinite;
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
```
with:
```css
.logo-pulse {
  position: relative;
}
```

- [ ] **Step 6: Flatten `.grid-bg`** (`globals.css:220-233`)

Replace the `.grid-bg` rule and its `html.dark .grid-bg` override with:
```css
.grid-bg {
  background: var(--color-canvas);
}
html.dark .grid-bg {
  background: var(--color-canvas);
}
```

- [ ] **Step 7: Simplify `.step-connector`** (`globals.css:236-239`)

Replace:
```css
.step-connector {
  height: 2px;
  background: linear-gradient(90deg, rgba(79,70,229,0.3), rgba(79,70,229,0.1));
}
```
with:
```css
.step-connector {
  height: 2px;
  background: var(--color-border);
}
```

- [ ] **Step 8: Flatten `.new-case-card`** (`globals.css:242-257`)

Replace the `.new-case-card` rule, its `:hover`, and both `html.dark` variants with:
```css
.new-case-card {
  border-color: var(--color-border);
  background: transparent;
}
.new-case-card:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-subtle);
}
```

- [ ] **Step 9: Verify build**

Run: `pnpm build`
Expected: succeeds. (The unused `@keyframes float/shimmer/pulse-ring/pulse` remain; that's fine.)

- [ ] **Step 10: Commit**

```bash
git add src/renderer/styles/globals.css
git commit -m "refactor(theme): flatten neumorphic/glow/shimmer/noise/grid effects"
```

---

## Task 3: Bar-chart palette → SourcesBlock

**Files:**
- Create: `src/renderer/lib/chartColors.ts`
- Test: `tests/renderer/lib/chartColors.test.ts`
- Modify: `src/renderer/components/overview/overviewModel.ts:5-17` (remove inline palette), `:60` (use `CHART_SERIES`)
- Test (extend): `tests/renderer/overviewModel.test.ts`

**Interfaces:**
- Produces: `export const CHART_SERIES: readonly string[]` (20 hex colors), `export const CHART_AXIS: string`, `export const CHART_GRID: string`.
- Consumes (Task changes `overviewModel`): `CHART_SERIES` for per-source `tone` assignment (`CHART_SERIES[i % CHART_SERIES.length]`).

- [ ] **Step 1: Write the failing test** `tests/renderer/lib/chartColors.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { CHART_SERIES, CHART_AXIS, CHART_GRID } from '@renderer/lib/chartColors'

describe('chartColors', () => {
  it('exposes the 20-color OpenRouter bar palette', () => {
    expect(CHART_SERIES).toHaveLength(20)
  })

  it('starts with the Recharts default four', () => {
    expect(CHART_SERIES.slice(0, 4)).toEqual(['#0088FE', '#00C49F', '#FFBB28', '#FF8042'])
  })

  it('contains only valid 6-digit hex colors', () => {
    for (const c of CHART_SERIES) expect(c).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('exposes zinc axis + grid colors', () => {
    expect(CHART_AXIS).toBe('#a1a1aa')
    expect(CHART_GRID).toMatch(/^#|rgba/)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test -- chartColors`
Expected: FAIL — cannot resolve `@renderer/lib/chartColors`.

- [ ] **Step 3: Create `src/renderer/lib/chartColors.ts`**

```ts
// OpenRouter's bar-chart series palette (Recharts default 4 + X11/CSS named colors),
// extracted from openrouter.ai's "Top Models" stacked bar chart. Mode-independent.
// Legend/tooltip reference (for any future real chart): dark popover, each row a small
// color swatch + label + right-aligned value, with a separated `Total` row.
export const CHART_SERIES = [
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
  '#FF69B4',
  '#9ACD32',
  '#4682B4',
  '#FF4500',
  '#FF6347',
  '#DA70D6',
  '#3CB371',
  '#F08080',
  '#BDB76B',
  '#800080',
  '#DAA520',
  '#2E8B57',
  '#40E0D0',
  '#6B8E23',
  '#7B68EE',
  '#DB7093'
] as const

// Chart axis lines / ticks (zinc-400) and grid lines (low-alpha zinc).
export const CHART_AXIS = '#a1a1aa'
export const CHART_GRID = 'rgba(161,161,170,0.2)'
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test -- chartColors`
Expected: PASS (4 tests).

- [ ] **Step 5: Extend the overviewModel test** `tests/renderer/overviewModel.test.ts`

Add this test inside the existing top-level `describe` (import `CHART_SERIES` at the top of the file: `import { CHART_SERIES } from '@renderer/lib/chartColors'`):
```ts
  it('assigns source tones from the OpenRouter chart palette by rank', () => {
    const now = 1_700_000_000_000
    const captures = [
      { id: 'a', url: 'https://aaa.com/1', createdAt: now },
      { id: 'b', url: 'https://aaa.com/2', createdAt: now },
      { id: 'c', url: 'https://bbb.com/1', createdAt: now }
    ] as unknown as Parameters<typeof computeOverview>[0]['captures']

    const result = computeOverview({ captures, notes: [], selectors: [], now })

    expect(result.sources[0].tone).toBe(CHART_SERIES[0])
    expect(result.sources[1].tone).toBe(CHART_SERIES[1])
  })
```
> Adjust the `captures`/`computeOverview` call shape to match the existing tests in this file (read the file's existing cases first; reuse their fixture pattern and the real `ComputeInput` field names). The assertion that matters: `sources[n].tone === CHART_SERIES[n]`.

- [ ] **Step 6: Run it, verify it fails**

Run: `pnpm test -- overviewModel`
Expected: FAIL — tones are still the old `#38bdf8…` palette, not `CHART_SERIES`.

- [ ] **Step 7: Rewire `overviewModel.ts`**

Remove the inline palette (lines 5-17, the comment + `const SOURCE_TONES = [ … ]`). Add at the top with the other imports:
```ts
import { CHART_SERIES } from '@renderer/lib/chartColors'
```
Change the tone assignment (was line 60):
```ts
    .map((s, i) => ({ ...s, tone: SOURCE_TONES[i % SOURCE_TONES.length] }))
```
to:
```ts
    .map((s, i) => ({ ...s, tone: CHART_SERIES[i % CHART_SERIES.length] }))
```

- [ ] **Step 8: Run tests, verify pass**

Run: `pnpm test -- overviewModel chartColors`
Expected: PASS (existing overviewModel tests + the new tone test + chartColors).

- [ ] **Step 9: Lint**

Run: `pnpm lint`
Expected: passes.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/lib/chartColors.ts tests/renderer/lib/chartColors.test.ts src/renderer/components/overview/overviewModel.ts tests/renderer/overviewModel.test.ts
git commit -m "feat(overview): use OpenRouter bar-chart palette for source breakdown"
```

---

## Task 4: Raised flat overlays + 6px buttons

**Files:**
- Modify: `src/renderer/components/ui/button.tsx:8` (radius)
- Modify: `src/renderer/components/ui/dialog.tsx:52` (panel)
- Modify: `src/renderer/components/layout/CommandPalette.tsx:86` (panel)
- Modify: `src/renderer/components/selectors/BulkAddSelectorsModal.tsx:118` (panel)
- Modify: `src/renderer/components/export/ExportDialog.tsx:90` (panel)
- Modify: `src/renderer/components/layout/OnboardingWizard.tsx:108,177` (panels)

**Interfaces:**
- Consumes: `.neu-overlay` (Task 2), `--radius-md` (Task 1).

> CSS/markup change — verified by `pnpm build` + Task 5 screenshots. Swap `neu-card` → `neu-overlay` on floating panels only; leave static `neu-card` cards (`card.tsx`, `CaseOverview`, `MetricRow`, `SinceLastVisitBanner`, `TagManager:114` inline) untouched.

- [ ] **Step 1: Primary button to 6px** (`button.tsx`, the `cva` base string at line 8)

In the base classes string, change the leading `rounded-lg` to `rounded-md`:
```ts
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none',
```

- [ ] **Step 2: Dialog panel** (`dialog.tsx:52`)

Change:
```tsx
          className={cn('neu-card rounded-2xl p-6 w-full max-w-md', className)}
```
to:
```tsx
          className={cn('neu-overlay rounded-2xl p-6 w-full max-w-md', className)}
```

- [ ] **Step 3: Command palette panel** (`CommandPalette.tsx:86`)

Change:
```tsx
            className="h-fit w-full max-w-lg rounded-xl border border-border-strong bg-card shadow-2xl"
```
to:
```tsx
            className="h-fit w-full max-w-lg rounded-xl neu-overlay"
```

- [ ] **Step 4: Bulk-add selectors modal panel** (`BulkAddSelectorsModal.tsx:118`)

Change:
```tsx
        className="neu-card w-[32rem] max-w-[90vw] rounded-2xl p-6"
```
to:
```tsx
        className="neu-overlay w-[32rem] max-w-[90vw] rounded-2xl p-6"
```

- [ ] **Step 5: Export dialog panel** (`export/ExportDialog.tsx:90`)

Change:
```tsx
        className="neu-card w-[28rem] rounded-2xl p-6"
```
to:
```tsx
        className="neu-overlay w-[28rem] rounded-2xl p-6"
```

- [ ] **Step 6: Onboarding wizard panels** (`OnboardingWizard.tsx:108` and `:177`)

At both lines change `neu-card rounded-2xl p-8` to `neu-overlay rounded-2xl p-8`:
```tsx
                className="neu-overlay rounded-2xl p-8"
```

- [ ] **Step 7: Verify build + lint**

Run: `pnpm build && pnpm lint`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ui/button.tsx src/renderer/components/ui/dialog.tsx src/renderer/components/layout/CommandPalette.tsx src/renderer/components/selectors/BulkAddSelectorsModal.tsx src/renderer/components/export/ExportDialog.tsx src/renderer/components/layout/OnboardingWizard.tsx
git commit -m "feat(chrome): raised flat overlays + 6px buttons"
```

---

## Task 5: Verification — both-theme screenshots + full suite

**Files:**
- Create: `e2e/theme-screenshots.spec.ts`

**Interfaces:**
- Consumes: `./fixtures/electronApp` test fixture (existing). Mirrors the case-seeding pattern in `e2e/case-overview.spec.ts`.

> This task produces evidence, not behavior. It captures Dashboard + CaseOverview in light and dark for human review against the OpenRouter reference screenshots, and runs the full suite.

- [ ] **Step 1: Read the seeding pattern**

Read `e2e/case-overview.spec.ts` fully. Note how it creates a case and adds captures so `SourcesBlock` has data, and which selectors/testids it uses. Reuse that exact pattern in the next step (do not invent testids).

- [ ] **Step 2: Write the screenshot spec** `e2e/theme-screenshots.spec.ts`

```ts
import { test } from './fixtures/electronApp'

async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
}

test.describe('theme screenshots', () => {
  test('dashboard + case overview in both themes', async ({ page }) => {
    // Dashboard
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/theme-dashboard-${theme}.png`, fullPage: true })
    }

    // Seed a case + captures using the SAME steps as e2e/case-overview.spec.ts,
    // then land on the overview route so SourcesBlock renders, e.g.:
    //   await page.evaluate(() => { window.location.hash = '/cases/new' })
    //   ...fill case-name-input, click case-create-btn, wait for overview URL...
    //   ...add captures per case-overview.spec.ts...

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/theme-overview-${theme}.png`, fullPage: true })
    }
  })
})
```
> Fill in the seeding block with the verbatim steps from `case-overview.spec.ts` (Step 1). If seeding proves flaky under WSLg, keep the Dashboard captures and note the gap.

- [ ] **Step 3: Run the screenshot spec**

Run: `pnpm test:e2e -- theme-screenshots`
Expected: PASS; PNGs written to `test-results/theme-*.png`. (Note: `pretest:e2e` runs `pnpm build` first.)

- [ ] **Step 4: Review the screenshots**

Read each `test-results/theme-*.png`. Check against the OpenRouter reference (scratchpad `openrouter-tokens.md`): zinc neutrals, `#6467f2` accent, flat surfaces, raised modals, Inter, `SourcesBlock` showing the new palette. Note any contrast/legibility issues (esp. light zinc-50 page vs white cards; `text-faint`).

- [ ] **Step 5: Run the full unit suite + lint + build**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all pass. If any e2e visual-snapshot baselines exist and now differ, update them deliberately and note in the PR.

- [ ] **Step 6: Commit**

```bash
git add e2e/theme-screenshots.spec.ts
git commit -m "test(theme): screenshot both themes for reskin verification"
```

---

## Self-review (completed by plan author)

- **Spec coverage:** §1 tokens → Task 1; §1 radius/shadows → Task 1; §2 fonts → Task 1; §3 flatten → Task 2; §4 chart palette/SourcesBlock → Task 3; §5 overlays/buttons → Task 4; Verification → Task 5; Delivery (branch/commits) → Global Constraints + per-task commits. No gaps.
- **Placeholder scan:** no TBD/TODO; all CSS/TS shown verbatim. The two "adjust to match existing fixture" notes (Task 3 Step 5, Task 5 Step 2) are deliberate — they point at concrete existing files to copy from, not vague instructions.
- **Type consistency:** `CHART_SERIES`/`CHART_AXIS`/`CHART_GRID` names match across Task 3 definition, test, and `overviewModel` consumer. `.neu-overlay` defined in Task 2, consumed in Task 4. `--shadow-overlay`/`--radius-2xl` defined in Task 1, consumed in Tasks 2/4.
