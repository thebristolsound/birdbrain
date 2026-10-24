Open source web investigation and capture tool. An Electron desktop app and companion Chrome extension that capture web content into per-case archives with a hash-chained audit trail, then let an investigator search, tag, annotate and export findings.

The interface is zinc neutrals plus one indigo accent, flat, bordered rather than elevated, dense, set in Inter at 12px. Nothing decorates; every colour that is not neutral means something.

## Content fundamentals

- **Audience:** investigators, activists and researchers under real stakes and time pressure. Lead with the answer. Some readers have never opened a terminal.
- **Register:** plain, specific, limitation-forward. Second person, active voice, present tense. State what a mechanism proves and what it does not, in the same sentence.
- **Casing:** sentence case for titles, buttons and labels, no end punctuation. Procedure titles start with an imperative: "Create a case", not "Creating a case". The only uppercase is the eyebrow `section-label`.
- **Vocabulary is fixed.** Use the defined term and never its synonyms: *Case* (not project, folder, workspace), *Operator* (not user, analyst), *Capture* (not page, snapshot, record), *Exhibit* (not artifact, item, attachment), *Manifest* (the hash-chained audit log), *Selector*, *Persona* (not alias, profile, account), *Recapture* (not refresh), *Case Archive* (not backup), *Egress* (not VPN mode). The glossary is `CONTEXT.md` in the repository.
- **No assurance words unqualified.** Never "court-admissible", "tamper-proof", "forensically sound", "verified" on their own. Name the property: "a verified hash chain shows nobody edited the manifest without the installation's signing key".
- **No inflation.** Cut "powerful", "seamless", "robust", "simply", "easily", "AI-powered". Name the provider and model instead of "AI". No idioms, no emoji in UI copy.
- **Say where data goes.** Anything touching capture, storage, export or AI names its destination: a disk path, loopback port 19845, or the external host.
- **Shortcut hints are never a claim.** A `ContextMenuShortcut` shows only a route that exists.

## Colour

- Paint the page `color-canvas`; `body` is `color-canvas` with `color-text-secondary`. Sidebars and sub-regions sit on `color-surface`. Cards sit on `color-card` with a 1px `color-border`; that single step plus the border is the whole elevation ladder for content. Only floating surfaces (dialogs, the command palette, toasts) step up to `color-elevated` and carry `shadow-overlay`.
- **Flat means no glow.** `shadow-glow` and `shadow-btn` resolve to `none` and stay that way. Hover is a border change (`color-border` to `color-border-strong`) or a fill (`color-elevated`), not a lift.
- Text in four steps: `color-text-primary` for titles and input text, `color-text-secondary` for body, `color-text-muted` for descriptions and labels, `color-text-faint` for eyebrows, placeholders and hints. In light every pair clears 5:1 on every surface. In dark, `color-text-faint` sits at 4.1:1 on canvas and 3.5:1 on elevated, as shipped; keep it to eyebrows and hints, never to copy someone must read.
- **One accent.** `color-accent` is the only brand hue in the UI: primary buttons, links, the focus ring, selected states, the accent badge, the mention suggestion underline. Light darkens it to #4f52e0 so it clears 4.5:1 on zinc-50; dark keeps #6467f2. `color-accent-subtle` is its 10% (16% dark) tint for fills. White on the dark accent is 4.4:1, as shipped.
- **Status is a tinted triple, never a solid.** Success, danger and warning each have a 10% `-surface`, a 20% `-line` and a `-fg` foreground: `bg-success-surface border-success-line text-success-fg`. Light darkens each foreground two to three palette steps so 10-12px text clears 4.5:1 on its own tint; dark lifts back to the bright hue. Never an ad-hoc `rgba()`.
- **Categorical hues** (`color-hue-orange-fg`, `color-hue-sky-fg`, `color-hue-pink-fg`) colour case-type pills and the NEW badge, always with a word in the pill; crypto reads orange in both themes.
- The raw palette (`color-indigo-*`, `color-amber-*`, `color-emerald-*`, `color-red-*`, `color-teal-500`, `color-slate-*`) is for entity types, severity and one-offs, the one allowed exception to "semantic tokens over raw colour". `color-violet-500` and `color-pink-500` exist so a mention chip can reference a token; a chip carries its entity's colour inline as `--mention-color` at 14% fill and a 28% ring.
- The shadcn bridge tokens (`color-background`, `color-foreground`, `color-muted`, `color-ring`, …) are aliases; set the semantic token they point at, never the bridge.
- Keyboard focus is `2px solid color-ring` with `2px` offset on every control that draws no ring of its own; the default Button draws the same outline. Never a box-shadow ring on the default button: `shadow-btn` is `none` and would invalidate the composed list.
- Native controls follow `color-scheme` (light / dark) so selects, radios and scrollbars match the theme. Scrollbars are 6px, `rgba(0,0,0,0.15)` on light and `rgba(255,255,255,0.10)` on dark.

## Typography

- Everything is Inter Variable (`body` and `display` are the same stack); code, hashes, counts and shortcut hints are JetBrains Mono Variable (`mono`). Both ship as latin variable woff2 files under `fonts/`, OFL-licensed; no external font request.
- The working size is `text-xs` (12px / 16px): buttons, inputs, badges, menu items, card titles, toast titles. Dense data drops to `text-11` and `text-10`; `text-sm` (14px) is for dialog titles, descriptions, labels and tabs. `text-lg` heads a page; `text-2xl` is a metric; `text-4xl` is the one display size.
- Weights: 400 for copy, 500 for buttons, badges and tab triggers, 600 for titles, eyebrows and emphasis. Nothing bolder.
- Panel heads are an eyebrow, not a heading: `section-label` (10px, 600, uppercase, `tracking-label`, `color-text-faint`). `section-label-strong` is the 11px step in `color-text-secondary` for heads that carry more weight.
- Card titles track tight: `card-title` uses `tracking-display` (-0.025em).
- Notes render through `.note-prose` whether being written or read: `note-body` 14px at 1.6, headings `note-h1/2/3` at 19 / 17 / 15px in `color-text-primary`, `note-code` in mono on `color-elevated`, links in `color-accent` underlined, blockquotes with a 2px `color-border` rule.

## Spacing and density

- Birdbrain pads by density step, not by a fixed scale. The twelve `d-*` tokens (`d-pad`, `d-gap`, `d-row`, `d-head`, …) scale padding, row heights and gaps across three steps set on `<html data-density>`: compact (a fresh install), the default, and comfortable. Read a density-aware metric as `var(--d-row)`, never a literal.
- Density never touches radius: `d-r` is declared once on `:root` as `var(--radius)`.
- Inside components the Tailwind scale applies: cards pad 20px (`p-5`), dialogs 24px (`p-6`), the recessed `CardPanel` 12px (`p-3`), menu panels 4px with 8px / 6px items.
- **One control metric:** 28px tall, 4px radius, 0 11px padding, 12px text. Every Button size but `lg` (36px, 6px radius, for the dashboard hero only) aliases to it; icon buttons are 28px square, `icon-sm` 24px. Inputs and textareas share the metric's padding (10px / 6px) and text size.
- Toasts: bottom-centre, 22px up, at most 520px wide, gone after six seconds.

## Radius

- The scale is 2 / 4 / 6 and nothing else: `radius-sm`, `radius-md`, `radius` (0.375rem). `radius-lg`, `radius-xl` and `radius-2xl` all alias the 6px ceiling, so `rounded-2xl` on a Card or Dialog renders 6px.
- Controls take `radius-md` (4px); cards, dialogs, toasts and tab lists take `radius` (6px).
- `rounded-full` is legal only for status pills, the Badge, and dots.

## Borders and elevation

- Surfaces are border-defined. Cards: 1px `color-border`, hover to `color-border-strong`. Inputs: 1px `color-input`, focus to `color-accent`. Outline buttons, menu panels, toasts and the recessed CardPanel: `color-border-strong`.
- Separators are 1px `color-border`; the step connector is 2px of it.
- Overlays dim the page with `rgba(0,0,0,0.5)` and raise the dialog on `color-elevated` with `shadow-overlay`.

## Motion

- Springs from `src/renderer/lib/motion/springs.ts`: `snappy` 400 / 30 (fade-up, scale-in, popovers, list items, collapse), `gentle` 200 / 24 (modals, slide panels), `microTap` 600 / 28 (button `whileTap` scale 0.97), `hover` 350 / 32 (card lift of 2px when `interactive`). Overlays fade in 0.2s; staggered lists step 40ms, capped at 20 children.
- Modals enter from opacity 0, scale 0.96, y 12; popovers from scale 0.97, y -4.
- Theme swaps cross-fade colour only (0.2s, `cubic-bezier(0.16, 0.84, 0.32, 1)`); layout never animates. Screen entrances rise 6px over 200ms with the same curve, staggered 25ms.
- `html.reduce-motion` and `prefers-reduced-motion` zero every transition and animation; the rail-button press scale is dropped too.

## Iconography

- Icons are lucide (`lucide-react`), stroked, sized by context: 16px in tab triggers, 10px at stroke 3 inside a 17px toast medallion, 11px for the toast close. No icon set ships in the repository; icons are drawn by the library at render time.
- Status icons live inside a round medallion filled with the status `-surface` and inked with its `-fg`: Check for success, TriangleAlert for error and warning, Info on `color-accent-subtle` for info.
- The mark is the Birdbrain bird (`assets/Logos/`): a dark bird with a cyan eye and an indigo node graph on its wing, on an indigo rounded square. Use the PNGs as shipped; no SVG mark exists. Set the wordmark in plain Inter at display weight.

## Components

- The primitives in `components/` are the app's `src/renderer/components/ui/` library, shadcn new-york style on radix-ui, motion and sonner. Each preview here is a static rendition hand-written from that file's exact classes; the consumer imports the real component from `@renderer/components/ui`.
- Prefer semantic theme tokens over raw colour values in components; overlays and status or severity colours are the exceptions.
- Right-click menus are one component, `ContextMenu`; do not hand-roll a fourth menu. Dialogs own Escape and trap Tab; a modal that cannot take Dialog's markup still runs on `useModalEscape` and `useModalFocus`.

## Not synced

- Variables skipped: the `--mention-color` custom property (set inline per entity, no value in CSS); the `color-mix()` chip fills and rings derived from it; the `.theme-fading` transition and the keyframes (`float`, `shimmer`, `pulse-ring`, `pulse`, `screen-rise`, `map-fade`, `map-pop`, `match-mode-slide`) have no token family.
- The compact and comfortable density steps are recorded in each `d-*` usage note, not as separate values; `d-r` carries its resolved value (0.375rem) rather than the `var(--radius)` reference.
- Fonts: the latin subsets only. The app loads the full `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` packages at build time; those files are not in the repository. Inter came from `extension/src/fonts/`, JetBrains Mono from the 2026-09-14 design handoff bundle.
- Components took the read-only route: every preview is a static rendition hand-written from its `src/renderer/components/ui/*.tsx` classes, no bundle was built, and `ScrollArea`, `Dialog`, `Tabs` and `ContextMenu` show their resting markup without radix, motion or sonner behaviour. Hooks (`useModalEscape`, `useModalFocus`, `trapTab`) and the `tabsListVariants` / `buttonVariants` / `badgeVariants` helpers get no card.
- No icon set, no SVG logo and no chart palette (`SOURCE_TONES`) were found in the renderer at this commit.
