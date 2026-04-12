# UI Primitives Migration — Remaining Work

## What's done

All primitives are built and live in `src/renderer/components/ui/`:

| Primitive | File | Variants / Notes |
|-----------|------|-----------------|
| `Button` | `button.tsx` | `default`, `destructive`, `outline`, `ghost`, `link` + sizes `xs`, `sm`, `default`, `lg`, `icon`, `icon-sm` |
| `Input` | `input.tsx` | Styled `<input>` with focus ring, disabled state |
| `Textarea` | `textarea.tsx` | Same styling as Input, multi-line |
| `Dialog` | `dialog.tsx` | `Dialog` (AnimatePresence root), `DialogContent` (overlay + panel), `DialogHeader/Title/Description/Footer` |
| `Card` | `card.tsx` | Wraps `.neu-card`, optional `hover` prop. Sub-components: `CardHeader/Title/Description/Content/Footer` |
| `Label` | `label.tsx` | Form label with default `mb-1 block text-sm text-text-muted` |

Import via: `import { Button, Input, Card, ... } from '@renderer/components/ui'`

`cn()` utility at `src/renderer/lib/utils.ts` for conditional/merged classes.

33 files have been migrated. Lint, build, and all 292 tests pass.

---

## What's left

76 raw `<button>` elements remain across 28 files. The list below is prioritized by value (buttons that clearly map to Button variants) vs. bespoke (custom state-driven styling that would require className overrides defeating the purpose).

### Tier 1 — High value, straightforward swaps

These files have buttons that map cleanly to existing Button variants.

#### `CaptureViewer.tsx` (14 buttons, 2 `neu-card`)

The biggest remaining file. Recommended approach:

| Element | Location | Primitive |
|---------|----------|-----------|
| Prev/Next nav | lines 187-200 | `Button variant="ghost" size="icon-sm"` |
| Download | line 354-359 | `Button variant="ghost" size="icon-sm"` |
| Open External | line 360-365 | `Button variant="ghost" size="icon-sm"` |
| Overflow trigger | line 372-376 | `Button variant="ghost" size="icon-sm"` |
| "Add note" menu item | line 382-390 | leave as `<button>` (dropdown menu item, not a standalone button) |
| "Delete capture" menu item | line 393-401 | leave as `<button>` (dropdown menu item) |
| Delete confirm dialog | lines 510-536 | `Dialog` + `DialogContent` + `Button variant="ghost"` + `Button variant="destructive"` |
| Delete confirm `neu-card` | line 515 | `Card` |
| Screenshot `neu-card` | line 438 | `Card` |
| View tabs (5x) | lines 416-430 | leave as `<button>` (tab pattern with bottom accent bar, same as DatabaseAdmin/SettingsView) |
| Tag popover trigger | line 221-238 | leave as `<button>` (custom badge + count layout) |
| Tag list buttons in popover | line 268-279 | leave as `<button>` (dropdown menu items) |
| Color picker swatches | line 306-318 | leave as `<button>` (tiny round color swatches) |
| Inline tag input | line 322-343 | leave as raw `<input>` (transparent bg, no border — doesn't match Input primitive) |

**Quick win**: The delete confirm dialog at lines 510-536 is a near-exact copy of `ConfirmDialog.tsx` — extract it to use the existing `ConfirmDialog` (already migrated to Dialog primitive) or compose directly with `Dialog` + `Button`.

#### `OnboardingWizard.tsx` (3 buttons, 2 `neu-card`)

| Element | Primitive |
|---------|-----------|
| Step 0 "Skip/Continue" button | `Button className="rounded-xl px-6 py-2.5 gap-2 shadow-[var(--shadow-btn)]"` |
| Step 1 "Back" button | `Button variant="ghost"` |
| Step 1 "Create & Start" button | `Button className="rounded-xl px-6 py-2.5 gap-2 shadow-[var(--shadow-btn)]"` |
| Step 0 card (`neu-card rounded-2xl p-8`) | `Card className="p-8"` |
| Step 1 card (`neu-card rounded-2xl p-8`) | `Card className="p-8"` |
| Step 1 `<input>` | `Input className="rounded-xl px-4 py-2.5"` |
| Step 1 `<label>` | `Label` |

#### `CaptureHealth.tsx` (4 buttons)

| Element | Primitive |
|---------|-----------|
| "Clear" link | `Button variant="ghost" size="xs"` |
| "Test Pipeline" | `Button variant="outline" size="xs"` |
| "Test HTTP" | `Button variant="outline" size="xs"` |
| Health badge trigger | leave as `<button>` (bespoke status-conditional colors) |

#### `CaseCard.tsx` (5 buttons remaining)

Context menu buttons inside the dropdown. These are dropdown menu items, not standalone buttons — **leave as `<button>`**. Converting them to `Button` would add padding/sizing that breaks the menu layout.

#### `NoteCard.tsx` (3 buttons remaining)

| Element | Primitive |
|---------|-----------|
| "Confirm" delete | `Button variant="destructive" size="xs"` |
| "Cancel" delete | `Button variant="ghost" size="xs"` |
| Source URL link | leave as `<button>` (inline text link with truncation) |

### Tier 2 — Lower value or bespoke

These files have buttons with custom styling that doesn't map to Button variants. Migrating them would require heavy `className` overrides, which defeats the purpose. **Recommended: skip these.**

| File | Count | Why skip |
|------|-------|----------|
| `Sidebar.tsx` | 2 | Nav buttons with absolute-positioned left-edge accent bar on active state |
| `CommandPalette.tsx` | 2 | Case list items with keyboard-driven selected state (`onMouseEnter` + `ArrowUp/Down`) |
| `HeroSection.tsx` | 2 | Hero CTAs with `shadow-lg shadow-indigo-500/40`, `active:scale-[0.98]`, hover glow — fully bespoke |
| `ProvenanceBadge.tsx` | 5 | Each button has a unique status-conditional color (emerald/amber/red/gray bg + text) |
| `SearchBar.tsx` | 3 | Expand/collapse search icon, inline clear button, result list items |
| `SessionControls.tsx` | 1 | Toggle switch (`role="switch"`) — not a button |
| `AppearanceConfig.tsx` | 3 | Theme toggle cards (already use `cn()`) + disabled reduce-motion switch |
| `CaptureList.tsx` | 3 | Sort/Filter buttons + selector filter clear X |
| `CaptureItem.tsx` | 2 | Checkbox toggle + favorite star — both use `role`/`aria` attributes for accessibility, bespoke color logic |
| `DatabaseAdmin.tsx` | 1 | Tab button with `border-b-2` active indicator |
| `SettingsView.tsx` | 1 | Tab button with same pattern |
| `TagBadge.tsx` | 1 | Inline colored pill — not a standard button shape |
| `CreateSelectorCard.tsx` | 2 | Regex toggle (`.* pill` with conditional accent border) + the collapsible header button |
| `SelectorTableRow.tsx` | 4 | Toggle switch + filter pill + 2 icon buttons (FlaskConical, Trash2) |
| `SelectorFilterFooter.tsx` | 1 | Tag remove X inside accent pill |
| `DbUtilities.tsx` | 3 | Red-bordered destructive buttons (Purge/Clean/Restore) — `variant="destructive"` is solid red which doesn't match |
| `DbTables.tsx` | 2 | Edit/Delete icon buttons in table rows (tiny `p-1` size) |
| `CaseHeader.tsx` | 2 | Chevron toggle + editable name click-to-edit |
| `TopBar.tsx` | 1 | Logo home button with glow icon |

### Remaining `neu-card` occurrences

| File | Count | Notes |
|------|-------|-------|
| `CaptureViewer.tsx` | 2 | Screenshot browser chrome + delete confirm dialog |
| `OnboardingWizard.tsx` | 2 | Step cards |
| `ExportDialog.tsx` | 1 | Dialog panel (uses motion.div, parent AnimatePresence) |
| `BulkAddSelectorsModal.tsx` | 1 | Dialog panel (same pattern) |
| `TagManager.tsx` | 1 | Inline mode |

For `ExportDialog` and `BulkAddSelectorsModal`: the `neu-card` is on a `motion.div` with `{...presets.modal}` spread. These can't use `<Card>` directly because Card renders a plain `<div>`, not `<motion.div>`. Options: (a) add the `neu-card` class via `className` on the motion.div (already done), or (b) create a `MotionCard` that uses `motion.div` instead. Not worth the complexity — leave as-is.

### Remaining raw `<textarea>` (1 file)

`CaseHeader.tsx` line 217-226: editable description textarea with `resize-none rounded border border-accent bg-elevated` — this is an inline edit field (not a form textarea), so `Textarea` primitive doesn't fit well.

---

## Migration recipe

For each file:

1. Add import: `import { Button, Card, ... } from '@renderer/components/ui'`
2. For `<button className="...">`  with a matching variant:
   - Determine variant: `bg-accent` → default, `bg-red-600` → destructive, `border border-border` → outline, `hover:bg-elevated` (no bg) → ghost
   - Determine size by height: `h-7 w-7` → `icon-sm`, `h-9 w-9` → `icon`, `h-8 px-3` → `sm`, `h-9 px-4` → default
   - Replace: `<Button variant="..." size="...">`, remove redundant classes
   - Keep: `data-testid`, `aria-*`, `onClick`, `disabled`, `title`
   - Use `className` for any non-standard overrides (e.g. `shadow-lg`, `rounded-xl`)
3. For `<section className="neu-card rounded-2xl p-5">`:
   - Replace with `<Card><CardContent>...</CardContent></Card>`
   - Or `<Card className="p-5">...</Card>` if simpler
4. For `<input type="text" className="...">`:
   - Replace with `<Input />`, keep all event handlers and data attributes
   - Override base styles via `className` if needed (e.g. `className="bg-canvas border-border"`)
5. For `<label className="mb-1 block text-sm text-text-muted">`:
   - Replace with `<Label>`, override via `className` if sizing differs
6. Preserve all `data-testid` attributes verbatim
7. Run `pnpm lint` — the linter will catch unused imports

## Verification

After each batch of changes:
- `pnpm lint` — no errors
- `pnpm build` — renderer bundle compiles
- `pnpm test` — all 292 tests pass
- `pnpm dev` — visual spot-check the modified screens

## Files NOT to touch

- `src/renderer/components/ui/*` — the primitives themselves
- `src/renderer/lib/utils.ts` — the `cn()` utility
- `src/renderer/styles/globals.css` — token bridge and visual polish (already complete)
- `extension/` — Chrome extension has its own styles, no shared primitives
