# Motion spec — animation & polish pass (updated 2026-08-12)

Applies app-wide. Personality: fast, crisp ease-out, instrument-like; subtle
intensity. Overshoot is reserved for toasts. All values live in
`Birdbrain.dc.html`'s helmet <style> (search `--mo`).

## Tokens

- `--ease: cubic-bezier(.16,.84,.32,1)` — the only easing curve.
- `--mo` — motion multiplier (1 or 0). Every duration is
  `calc(var(--mo) * Nms)`.
- `--bb-lift` — hover-lift shadow (per theme).

## Kill switches (all three must ship)

1. `@media (prefers-reduced-motion: reduce)` → `--mo: 0`.
2. Settings → Appearance "Reduce motion" toggle → `html.bb-nomo`
   (`animation:none; transition:none` on everything).
3. `motion` prop/tweak (demo screenshots) → same class.

## Screen-to-screen

- `.scr` on each route's root: fade + 5px rise, 150ms, every route change.

## Entrance stagger — FIRST visit per screen per session only

- `.stag` on list/grid containers (dashboard case grid, capture list, note
  list, signal rows, selectors, tags, wizard, overview metrics).
- Children: 200ms rise, 25ms/item delay, capped at 275ms (nth-child rules).
- Logic tracks visited routes (`_seen` map, marked 900ms after first
  render); revisits render statically. In production: in-memory per session.

## Micro-interactions

- All buttons: `:active { filter: brightness(.93) }`; sidebar nav adds
  `scale(.92)`; primary CTAs keep inline `scale(.98)`.
- Cards (`.lift`): hover translateY(-2px) + `--bb-lift` shadow, 150ms.
- Capture/note rows (`.liftrow`): hover = tint overlay fade-in (`::after`,
  text-primary at 4.5% opacity, 120ms). No transform — rows never move.
- `:focus-visible`: 2px accent outline, 1px offset — keyboard only.
- Scrollbars: 10px, transparent track, `--color-border-strong` thumb inset
  3px (padding-box clip), text-faint on hover.

## Overlays

- Menus / popovers / calendar / mention autocomplete / palette (`.pop`):
  scaleY(.92)→1 + fade, 130ms, transform-origin top.
- Wayback panel: fade-in (`bbfade`, 150ms) — it replaces the details panel
  in the same right-edge slot, so a width animation there fights the
  details panel's exit (opposing motion). No drawer expand.
- Capture details panel: fade-in (`bbfade`, 150ms) — same right-edge slot
  as the Wayback panel, so neither ever width-animates (opposing-motion
  rule); collapsed 40px rail keeps `bbdrawer`, 150ms.
- Bulk-import drawer (Signals): `.pop`, 130ms.
- Inline selection bar (captures + notes lists, replaces the old floating
  toolbar): `bbselbar` — 4px drop-in + fade, 150ms.
- Match-mode drawer (Signals add-selector, expands downward on input focus
  with Exact text / Regex cards): `bbselbar`, 150ms.

## Inputs

- Add-selector rows (`.selin`, Signals + Case Overview): border/background
  transition 180ms; `:focus-within` → solid accent border + accent-subtle bg.
- Selector list rows: `bbrise` 150ms on mount (new rows animate in).
- Range sliders: thumb scales 1.2× while dragging, 120ms.

## New-investigation wizard

- Step content: `bbslide` — 14px slide-in + fade, 180ms on step change.
- Progress pills: active pill widens 6→22px, 250ms; fill color 200ms.
- Create button: spinner (bbspin) during the mock 700ms create, then toast + dashboard.

## Screenshot pins (capture viewer)

- Pin drop (marker mount): `bbpindrop` — 10px fall + fade, 200ms.
- Markers counter-scale against canvas zoom (`scale(100/zoom)`,
  origin at the tip) so pins stay constant screen size at any zoom.
- Note popover: `bbrise` 160ms; flips above the marker when pin y > 55%.
- Pin legend (top-right): `bbrise` 160ms on mount; row expand is instant
  (chevron rotates 180°, 150ms); expanding a row halos its marker
  (3px accent ring at 35%).

## Key moments

- Toasts (`.toast`): 240ms entrance with slight overshoot
  (translateY 8px → -2px → 0); 2px accent progress bar (`bbtbar`,
  scaleX 1→0, linear) matching the 6s auto-dismiss timer exactly.
- Extension capture card: same entrance, no progress bar.
- Overview metrics: count up 0→value over 700ms, cubic ease-out (rAF);
  first visit only; skipped entirely under any kill switch.
- Link map: nodes pop in (scale .8 + fade, 24ms stagger from 120ms), edges
  fade in behind them — first visit only.
- Theme switch: `html.bb-theming` for 240ms — 200ms crossfade on
  background-color / color / border-color / fill / stroke.
- Empty-state icons: 4px float loop, 4.5s.

## Do not

- No glow shadows, no bounce outside toasts, no stagger on filter/search
  changes, no motion over 300ms anywhere.
