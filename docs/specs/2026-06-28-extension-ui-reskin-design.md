# Extension UI reskin — design

**Date:** 2026-06-28
**Status:** Draft (awaiting review)
**Author:** brainstormed against the OpenRouter flat reskin (ADR-0003,
`2026-06-28-openrouter-theme-reskin-design.md`) and the current extension source.

## Goal

Bring the Chrome extension's two user-facing surfaces — the **popup** and the page-injected
**capture toast** — in line with the OpenRouter flat reskin the desktop app just adopted: flat
zinc surfaces, a single indigo accent, Inter, and no glow/shimmer/pulse decoration. Additionally,
make the popup **follow the app's light/dark preference** instead of being dark-only.

The extension keeps its current structure and behaviour; this changes the *look*, plus one new
read (theme) over the existing status channel.

### Non-goals

- **No layout/IA changes.** Same as the app reskin: design *primitives* (colour, radius,
  borders, button styling, font) change; the popup's structure and the toast's behaviour do not.
- **No new runtime dependencies.** Inter ships as a single locally-bundled woff2 (copied from
  the `@fontsource-variable/inter` package the app already depends on). No network font requests.
- The content-script **selector highlight** (functional amber) is out of scope — it is a
  status/affordance colour, not branding.

## Current state (what's being retired)

- `extension/src/popup/popup.css` — a self-contained Tailwind v4 `@theme` with **dark-only OLED
  tokens** (`--color-d-body: #000`, `--color-d-card: #111827`, …), indigo `#6366f1`/`#4f46e5`
  accent, **Plus Jakarta Sans + DM Sans**, and decorative effect classes: `btn-glow`,
  `btn-glow-pulse`, `shadow-dark-btn`, `dark-card-glow`, `stat-glow`, `recording-ring`,
  `entity-dot` glow.
- `extension/src/popup/popup.tsx` — markup consuming the `d-*` tokens, `rounded-2xl/xl`,
  `bg-white/[0.04]` icon tiles (invisible on a light surface), `text-white` for primary text.
- `extension/src/popup/popup.html` — inlines `@font-face` for the two old fonts.
- `extension/src/fonts/` — `dm-sans-latin.woff2`, `plus-jakarta-sans-latin.woff2`, and an
  orphaned `fonts.css` (not imported anywhere; only `popup.html`'s inline `@font-face` is used).
- `extension/src/toast.ts` — shadow-DOM toast, `background: #1a1a2e`, system font stack.
- `extension/src/utils/api.ts` — `StatusResponse` has no `theme` field.
- `src/main/services/captureServer.ts` — `/api/status` does not expose the app theme.

The app stores `theme: 'light' | 'dark'` in settings (`src/shared/types.ts:109`); the renderer
toggles a `dark` class on `<html>` and persists via `settings.update`.

## Design

### 1. Theme plumbing — popup follows the app

The popup already calls `getStatus()` on mount. Surface the app theme over that same call.

- **`src/main/services/captureServer.ts`** (`/api/status` handler, ~line 189): add
  `theme: settings.theme` to the JSON response (`settings` is already read in the handler).
- **`extension/src/utils/api.ts`**: add `theme?: 'light' | 'dark'` to the `StatusResponse`
  interface.
- **`extension/src/popup/popup.tsx`**: when status resolves, toggle the `dark` class on
  `document.documentElement` from `status.theme` and cache it to `localStorage('bb-theme')`.
- **`extension/src/popup/popup.html`**: add a tiny inline `<head>` script that applies the cached
  class *before first paint* — mirroring the app's own flash-prevention pattern:
  ```html
  <script>try { if (localStorage.getItem('bb-theme') !== 'light') document.documentElement.classList.add('dark') } catch (e) {} </script>
  ```
  **Unknown / disconnected → dark** (the popup's heritage; the error and loading states read well
  in dark). A light-mode user sees at most one dark→light flip on the very first open, after which
  `bb-theme` is cached.

### 2. Popup token system (`popup.css`)

Replace the `--color-d-*` OLED tokens with the app's **exact semantic token names and values**, so
the popup markup reads like the app and both themes come for free. Light values in `@theme`; dark
overrides under `html.dark { }` (the same mechanism `globals.css` uses).

| token (popup = app)        | Light      | Dark       |
|----------------------------|------------|------------|
| `--color-canvas`           | `#fafafa`  | `#090a0b`  |
| `--color-surface`          | `#f4f4f5`  | `#0e0e11`  |
| `--color-card`             | `#ffffff`  | `#131316`  |
| `--color-elevated`         | `#ffffff`  | `#1c1c20`  |
| `--color-text-primary`     | `#09090b`  | `#fafafa`  |
| `--color-text-secondary`   | `#3f3f46`  | `#d4d4d8`  |
| `--color-text-muted`       | `#71717a`  | `#a1a1aa`  |
| `--color-text-faint`       | `#a1a1aa`  | `#71717a`  |
| `--color-accent`           | `#5659f0`  | `#6467f2`  |
| `--color-accent-hover`     | `#4f52e0`  | `#7a7cf5`  |
| `--color-accent-subtle`    | `rgba(100,103,242,.10)` | `rgba(100,103,242,.16)` |
| `--color-border`           | `#e4e4e7`  | `#27272a`  |
| `--color-border-strong`    | `#d4d4d8`  | `#3d3d42`  |

- **Radius:** add `--radius: 0.5rem` for the app scale. Outcome in markup: cards `rounded-xl`
  (12px), buttons `rounded-md` (6px).
- **Fonts:** `--font-display` and `--font-body` both → `"Inter Variable", ui-sans-serif,
  system-ui, sans-serif`. Drop the Jakarta/DM declarations.
- **Status colours** (`red/amber/emerald`, and the `indigo-*` scale if still referenced for
  status) stay as the allowed exception.
- **Effects:** delete `btn-glow` + `@keyframes btn-glow`, `btn-glow-pulse`, `shadow-dark-btn`,
  `dark-card-glow`, `stat-glow`, `recording-ring`, and the `entity-dot` glow. **Keep** `fadeUp` +
  `animate-fade-up*` (functional entrance) and `pulse-dot` + `status-recording` (functional
  recording indicator). `body { background: var(--color-canvas); color: var(--color-text-primary) }`.

### 3. Popup markup (`popup.tsx`)

Mechanical token swap throughout:

| from | to |
|------|----|
| `bg-d-body` | `bg-canvas` |
| `bg-d-header` | `bg-surface` |
| `bg-d-card` | `bg-card` |
| `border-d-border` | `border-border` |
| `text-d-text` | `text-text-primary` |
| `text-d-text-secondary` | `text-text-secondary` |
| `text-d-text-muted` | `text-text-muted` |
| `text-white` (primary text) | `text-text-primary` |
| `text-indigo-400` | `text-accent` |
| `bg-indigo-600` | `bg-accent` |
| `hover:bg-indigo-500` | `hover:bg-accent-hover` |
| `bg-white/[0.04]` icon tiles | `bg-surface hover:bg-elevated` |
| `focus:ring-indigo-500` | `focus:ring-accent` |
| `hover:text-indigo-300` + any remaining `indigo-*` | `accent` / `hover:bg-accent-hover` |

- Cards (`StatusCard`, `StatsGrid` tiles, `CaseSelector` empty state): flat
  `bg-card border border-border`, drop `dark-card-glow`; `rounded-2xl → rounded-xl`.
- Buttons: `rounded-xl → rounded-md`; primary is solid `bg-accent hover:bg-accent-hover`, drop
  `shadow-dark-btn btn-glow-pulse` (and the `disabled:animate-none disabled:shadow-none` that
  paired with them); **keep** `active:scale-[0.98]`. Stop button stays `bg-red-600` (status).
- Stat numbers: drop `stat-glow`; the captures number is `text-accent`, selectors number
  `text-text-primary`.
- Header logo chip: `bg-indigo-600 shadow-lg shadow-indigo-500/30` → `bg-accent` (no shadow).
- The recording badge keeps the `status-recording` pulsing dot; drop its `recording-ring` glow.
- Heading weight: ease `font-extrabold` → `font-bold`/`font-semibold` to match the app's
  restrained Inter weights (visual judgement during implementation).

### 4. Injected toast (`toast.ts`)

Update `TOAST_STYLES` to the flat zinc-dark idiom; **toast stays dark in both app themes** (it is
an overlay on arbitrary third-party pages, matching the app's "overlays stay raised/dark" rule,
and the content script has no theme channel):

- `.toast` `background: #1a1a2e` → `#131316`; `border: 1px solid #27272a`; keep a soft, non-glow
  drop `box-shadow` (the current `0 4px 12px rgba(0,0,0,.3)` already fits the flat-overlay idiom —
  retain or nudge toward `rgba(0,0,0,.4)`); keep `border-radius: 8px`.
- Status border colours (`success/error/degraded/skipped`) retained.
- Spinner `border-top-color` → accent `#6467f2`.
- Font stack stays system-ui (a bundled font can't be cleanly injected into host pages).

### 5. Fonts

- Add `extension/src/fonts/inter-latin-wght-normal.woff2` (copy of
  `node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2` — the same
  variable latin file the app uses).
- Remove `extension/src/fonts/dm-sans-latin.woff2` and `plus-jakarta-sans-latin.woff2`.
- `popup.html` inline `@font-face` → a single `Inter Variable` face pointing at the new file
  (`font-weight: 100 900`).
- `extension/src/fonts/fonts.css` → update to the Inter face (it references the now-removed
  files otherwise). It is currently unused, but kept coherent with the directory.
- The `copy-extension-assets` Vite plugin already copies `src/fonts/ → dist/fonts/`; no build
  change needed.

## Implementation order

1. Theme plumbing (`captureServer.ts`, `api.ts`, `popup.tsx`, `popup.html`).
2. Fonts swap (`src/fonts/*`, `popup.html`, `fonts.css`).
3. Popup tokens + effect removal (`popup.css`).
4. Popup markup token swap (`popup.tsx`).
5. Toast (`toast.ts`).

## Risks

- **Light-surface regressions:** `bg-white/[0.04]` tiles and `text-white` are invisible/wrong on a
  light card — caught by the token swap, but verify every popup element renders in **light** mode.
- **First-open theme flash:** mitigated by the `bb-theme` cache + inline script; a single flip on
  first-ever open for a light-mode user is acceptable.
- **Status-shape test:** if a test asserts the exact `/api/status` body, update it for the new
  `theme` field.

## Verification

- `pnpm build:extension`; load unpacked → screenshot the popup in **both** themes (toggle the app
  theme and reopen the popup) and trigger a capture to screenshot the toast.
- `pnpm lint`, `pnpm test`, `pnpm build` (the last covers the `captureServer.ts` change).
- User does final visual sign-off in both themes.

## Acceptance

- Popup matches the app: flat zinc surfaces, `#5659f0`(light)/`#6467f2`(dark) accent, 8px radius /
  6px buttons, Inter, no glow/shimmer/pulse — and **follows the app's light/dark setting**.
- Injected toast reads as the same flat dark card; spinner uses the accent.
- All popup text is Inter; no Jakarta/DM woff2 remains in the build; no external font requests.
- `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm build:extension` all pass.

## Delivery

Per repo rule (tracked docs never bundle with `src`): this spec lands in its **own commit/PR**;
the extension reskin lands separately. ADR-0003 already records the design direction — this is an
application of it to the extension, not a new architectural decision, so no new ADR.
