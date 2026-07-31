# Extension UI Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the Chrome extension's popup and injected capture toast to the OpenRouter flat theme, and make the popup follow the desktop app's light/dark preference.

**Architecture:** Surface the app's `theme` over the existing `/api/status` call; rewrite the popup's self-contained Tailwind v4 token set to mirror the app's semantic tokens (light defaults + `html.dark` overrides) with effects stripped; swap the popup markup onto those tokens and apply the theme class; restyle the shadow-DOM toast to the flat dark card idiom. Bundle Inter locally (no network fonts).

**Tech Stack:** TypeScript, React 19, Tailwind CSS v4 (`@tailwindcss/vite`), Vite, Hono (capture server), Vitest (Electron runtime).

## Global Constraints

- **Branch:** Do all implementation on a new branch `feat/extension-reskin` created off `master` (the spec lives separately on `docs/extension-reskin-spec`). The popup hardcodes its own token values, so it does not depend on any unmerged app branch.
- **Code style:** no semicolons, single quotes, no trailing commas, 2-space indent, 100-char width. React JSX transform (no `React` import needed for JSX, but existing files import it — match the file).
- **Commits:** `<type>(<scope>): <subject>`. **Never** add a `Co-authored-by` trailer. Stage files explicitly — never `git add .`/`-A`.
- **Semantic tokens only** in popup markup (`bg-canvas`, `text-text-*`, `border-border`, `bg-accent`, …); status colours (`red/amber/emerald`) are the only allowed raw-colour exception.
- **No new runtime dependencies.** Inter ships as one locally-bundled woff2 copied from the already-installed `@fontsource-variable/inter` package.
- **Token values are exact** — copy hexes verbatim from the tables below (sourced from the spec).

---

### Task 1: Expose the app theme over `/api/status`

**Files:**
- Modify: `src/main/services/captureServer.ts:189-200` (the `/api/status` JSON response)
- Modify: `extension/src/utils/api.ts:18-29` (`StatusResponse` interface)
- Test: `tests/main/services/captureServer.test.ts` (add one `it` inside the existing `describe('captureServer')`)

**Interfaces:**
- Produces: `GET /api/status` response now includes `theme: 'light' | 'dark'` (the value of `settings.theme`). The popup (Task 3) consumes `status.theme`.

- [ ] **Step 1: Write the failing test**

Add this test inside `describe('captureServer', () => { ... })` in `tests/main/services/captureServer.test.ts` (e.g. right after the `GET /api/status returns running state` test at line 94). `updateSettings` is already imported and used in `beforeEach`.

```ts
  it('GET /api/status exposes the app theme', async () => {
    updateSettings({ theme: 'light' })
    const light = await (await fetch(`${baseUrl}/api/status`)).json()
    expect(light.theme).toBe('light')

    updateSettings({ theme: 'dark' })
    const dark = await (await fetch(`${baseUrl}/api/status`)).json()
    expect(dark.theme).toBe('dark')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/main/services/captureServer.test.ts`
Expected: the new test FAILS (`theme` is `undefined`, so `expect(light.theme).toBe('light')` fails). Other tests still pass.

- [ ] **Step 3: Add `theme` to the status response**

In `src/main/services/captureServer.ts`, the `/api/status` handler already calls `const settings = getSettings()` (line 179). Add `theme` to the returned object. Change the tail of the `c.json({ ... })` (currently ending at `dedupeWindowSeconds: settings.dedupeWindowSeconds`):

```ts
      ignoredUrlPatterns: settings.ignoredUrlPatterns,
      captureScreenshots: settings.captureScreenshots,
      dedupeWindowSeconds: settings.dedupeWindowSeconds,
      theme: settings.theme
    })
```

- [ ] **Step 4: Add `theme` to the extension's `StatusResponse` type**

In `extension/src/utils/api.ts`, add the field to the `StatusResponse` interface (after `dedupeWindowSeconds?: number`):

```ts
  dedupeWindowSeconds?: number
  theme?: 'light' | 'dark'
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/main/services/captureServer.test.ts`
Expected: all tests PASS, including `GET /api/status exposes the app theme`.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/captureServer.ts extension/src/utils/api.ts tests/main/services/captureServer.test.ts
git commit -m "feat(extension): expose app theme over /api/status"
```

---

### Task 2: Bundle Inter, drop Plus Jakarta / DM Sans

**Files:**
- Create: `extension/src/fonts/inter-latin-wght-normal.woff2` (copied from node_modules)
- Delete: `extension/src/fonts/dm-sans-latin.woff2`, `extension/src/fonts/plus-jakarta-sans-latin.woff2`
- Modify: `extension/src/popup/popup.html:7-22` (inline `@font-face` block)
- Modify: `extension/src/fonts/fonts.css` (whole file)

**Interfaces:**
- Produces: an `Inter Variable` `@font-face` available to the popup at `./fonts/inter-latin-wght-normal.woff2`.

- [ ] **Step 1: Copy the Inter woff2 into the extension fonts dir**

Run:
```bash
cp node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2 extension/src/fonts/inter-latin-wght-normal.woff2
```

- [ ] **Step 2: Remove the old font files**

Run:
```bash
git rm extension/src/fonts/dm-sans-latin.woff2 extension/src/fonts/plus-jakarta-sans-latin.woff2
```

- [ ] **Step 3: Replace the inline `@font-face` in `popup.html`**

In `extension/src/popup/popup.html`, replace the entire `<style>…</style>` block in `<head>` (the two old `@font-face` rules) with a single Inter face:

```html
    <style>
      @font-face {
        font-family: 'Inter Variable';
        font-style: normal;
        font-weight: 100 900;
        font-display: swap;
        src: url('./fonts/inter-latin-wght-normal.woff2') format('woff2');
      }
    </style>
```

- [ ] **Step 4: Update `fonts.css` to match**

Replace the entire contents of `extension/src/fonts/fonts.css` with:

```css
/* Locally bundled Inter — eliminates external font requests.
   Variable font: one file covers all weights. */

@font-face {
  font-family: 'Inter Variable';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('./inter-latin-wght-normal.woff2') format('woff2');
}
```

- [ ] **Step 5: Build the extension to verify assets resolve**

Run: `pnpm build:extension`
Expected: build succeeds; `extension/dist/fonts/inter-latin-wght-normal.woff2` exists and `extension/dist/popup.html` references it. Verify:
```bash
ls extension/dist/fonts/ && grep -o "inter-latin-wght-normal.woff2" extension/dist/popup.html
```
Expected: the woff2 is listed and the grep prints the filename. The two old woff2 files should NOT be present in `extension/dist/fonts/`.

- [ ] **Step 6: Commit**

```bash
git add extension/src/fonts/inter-latin-wght-normal.woff2 extension/src/fonts/fonts.css extension/src/popup/popup.html
git commit -m "feat(extension): bundle Inter, drop Plus Jakarta and DM Sans"
```

---

### Task 3: Reskin the popup (tokens, effects, markup, theme sync)

This task is atomic: `popup.css` removes the `d-*` tokens that `popup.tsx` currently consumes, so the CSS rewrite and the markup swap must land together or the popup renders unstyled.

**Files:**
- Modify: `extension/src/popup/popup.css` (whole file)
- Modify: `extension/src/popup/popup.tsx` (token classes throughout + theme application)
- Modify: `extension/src/popup/popup.html` (add the pre-paint theme script)

**Interfaces:**
- Consumes: `status.theme` from Task 1 (`getStatus()` return type).

- [ ] **Step 1: Rewrite `popup.css`**

Replace the entire contents of `extension/src/popup/popup.css` with:

```css
@import "tailwindcss" source(none);
@source "../../";

@theme {
  /* Flat zinc surfaces — light defaults; html.dark overrides below */
  --color-canvas: #fafafa;
  --color-surface: #f4f4f5;
  --color-card: #ffffff;
  --color-elevated: #ffffff;
  --color-text-primary: #09090b;
  --color-text-secondary: #3f3f46;
  --color-text-muted: #71717a;
  --color-text-faint: #a1a1aa;
  --color-accent: #5659f0;
  --color-accent-hover: #4f52e0;
  --color-accent-subtle: rgba(100,103,242,0.10);
  --color-border: #e4e4e7;
  --color-border-strong: #d4d4d8;

  /* Status palette (allowed raw-colour exception) */
  --color-red-400: #f87171;
  --color-red-500: #ef4444;
  --color-amber-500: #f59e0b;
  --color-emerald-500: #22c55e;

  --radius: 0.5rem;

  --font-display: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
}

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

body {
  width: 320px;
  margin: 0;
  overflow: hidden;
  background: var(--color-canvas);
  color: var(--color-text-primary);
  font-family: var(--font-body);
}

/* Functional motion only — no decorative glow/shimmer/pulse */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.15); }
}

.animate-fade-up {
  animation: fadeUp 0.3s ease-out forwards;
}

.animate-fade-up-delay-1 {
  animation: fadeUp 0.3s ease-out 0.1s forwards;
  opacity: 0;
}

.animate-fade-up-delay-2 {
  animation: fadeUp 0.3s ease-out 0.2s forwards;
  opacity: 0;
}

.status-recording {
  animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```

(Removed: all `d-*` OLED tokens, `indigo-*`/`sky-400`/`yellow-500` tokens, Jakarta/DM fonts, and the `btn-glow`/`btn-glow-pulse`/`shadow-dark-btn`/`recording-ring`/`dark-card-glow`/`stat-glow`/`entity-dot` effect classes + the `btn-glow` keyframes.)

- [ ] **Step 2: Add the pre-paint theme script to `popup.html`**

In `extension/src/popup/popup.html`, inside `<head>` (after the `<style>` font block from Task 2, before `</head>`), add:

```html
    <script>
      try {
        if (localStorage.getItem('bb-theme') !== 'light')
          document.documentElement.classList.add('dark')
      } catch (e) {}
    </script>
```

This applies dark before first paint unless the user's last-known theme was light. Unknown/first-open ⇒ dark.

- [ ] **Step 3: Apply the theme from status in `popup.tsx`**

Add a helper near `openInApp` (after line 17) in `extension/src/popup/popup.tsx`:

```tsx
function applyPopupTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem('bb-theme', theme)
  } catch {
    //
  }
}
```

In `checkStatus()`, after `setConnected(status.running)` (line 385), apply the theme when present:

```tsx
      setConnected(status.running)
      if (status.theme) applyPopupTheme(status.theme)
```

- [ ] **Step 4: Swap the markup tokens in `popup.tsx`**

Apply these class replacements **throughout** `popup.tsx` (every occurrence). They are mechanical string swaps:

| from | to |
|------|----|
| `bg-d-body` | `bg-canvas` |
| `bg-d-header` | `bg-surface` |
| `bg-d-card` | `bg-card` |
| `border-d-border` | `border-border` |
| `text-d-text` | `text-text-primary` |
| `text-d-text-secondary` | `text-text-secondary` |
| `text-d-text-muted` | `text-text-muted` |
| `text-white` | `text-text-primary` |
| `text-indigo-400` | `text-accent` |
| `hover:text-indigo-300` | `hover:text-accent-hover` |
| `bg-indigo-600` | `bg-accent` |
| `hover:bg-indigo-500` | `hover:bg-accent-hover` |
| `focus:ring-indigo-500` | `focus:ring-accent` |
| `bg-white/[0.04]` | `bg-surface` |
| `hover:bg-white/[0.04]` | `hover:bg-elevated` |
| `hover:bg-white/[0.08]` | `hover:bg-elevated` |
| `rounded-2xl` | `rounded-xl` |

Then remove these now-undefined effect/glow classes wherever they appear (delete the token from the `className` string, leave surrounding classes):

- `dark-card-glow`
- `stat-glow`
- `btn-glow-pulse`
- `recording-ring`
- `shadow-dark-btn`
- `shadow-lg shadow-indigo-500/30` (on the header logo chip and loading chip — delete both tokens)
- `shadow-lg shadow-red-600/25` (on the Stop button — delete both tokens; the button stays `bg-red-600`)
- `disabled:animate-none disabled:shadow-none` (on the Start button — paired with the removed glow; delete both tokens)

Button radius: the Start/Stop/icon buttons use `rounded-xl` → after the table swap they become `rounded-xl`→`rounded-md`? No — buttons should be 6px. Change the button elements specifically from `rounded-xl` to `rounded-md` (the Start button, Stop button, manual-capture button, settings button, and the Retry button in `DisconnectedView`). Cards keep `rounded-xl` (from the `rounded-2xl→rounded-xl` table swap).

> Note: apply the `rounded-2xl → rounded-xl` table swap first (cards become 12px), then set the five **button** elements to `rounded-md` (6px). The select in `CaseSelector` stays `rounded-xl`.

- [ ] **Step 5: Build the extension and lint**

Run: `pnpm build:extension && pnpm lint`
Expected: both succeed with no errors. There should be no remaining references to removed classes:
```bash
grep -nE "d-body|d-header|d-card|d-border|d-text|indigo-|btn-glow|dark-card-glow|stat-glow|recording-ring|shadow-dark-btn" extension/src/popup/popup.tsx
```
Expected: no output (all swapped/removed).

- [ ] **Step 6: Visually verify both themes**

Load `extension/dist` as an unpacked extension in Chrome with the desktop app running. Open the popup with the app set to **dark**, then toggle the app to **light** (Settings → Appearance) and reopen the popup. Confirm: flat zinc surfaces, single indigo accent, Inter, no glow/shimmer; light mode is fully legible (no white-on-white, no invisible icon tiles); the recording dot still pulses during a session.

- [ ] **Step 7: Commit**

```bash
git add extension/src/popup/popup.css extension/src/popup/popup.tsx extension/src/popup/popup.html
git commit -m "feat(extension): reskin popup to flat OpenRouter theme with light/dark sync"
```

---

### Task 4: Reskin the injected capture toast

**Files:**
- Modify: `extension/src/toast.ts:21-76` (`TOAST_STYLES`)

**Interfaces:** none (self-contained shadow-DOM styles).

- [ ] **Step 1: Update the toast base styles**

In `extension/src/toast.ts`, update the `.toast` rule and the `.spinner` rule inside `TOAST_STYLES`. The toast stays dark in both app themes (it overlays arbitrary third-party pages). Change:

```css
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    line-height: 1;
    color: #fafafa;
    background: #131316;
    border: 1px solid #27272a;
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s, transform 0.2s;
  }
```

(Changed: `color #fff→#fafafa`, `background #1a1a2e→#131316`, `border rgba(255,255,255,0.1)→#27272a`, `box-shadow 0 4px 12px rgba(0,0,0,0.3)→0 10px 30px rgba(0,0,0,0.4)`.) Leave the `.toast.visible`, `.toast.success/.error/.degraded/.skipped` status-border rules unchanged.

Update the spinner accent:

```css
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.2);
    border-top-color: #6467f2;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
```

(Changed: `border-top-color #fff→#6467f2`.)

- [ ] **Step 2: Build and verify**

Run: `pnpm build:extension && pnpm lint`
Expected: both succeed. Load the extension, start a session, and trigger a capture on any page; confirm the toast renders as a flat dark zinc card with an indigo spinner and the correct status border colour.

- [ ] **Step 3: Commit**

```bash
git add extension/src/toast.ts
git commit -m "feat(extension): reskin capture toast to flat dark card"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite**

Run: `pnpm lint && pnpm test && pnpm build && pnpm build:extension`
Expected: all four succeed. `pnpm build` covers the `captureServer.ts` change; `pnpm test` includes the new status test.

- [ ] **Step 2: Cross-theme visual sign-off**

With the app running, capture screenshots of: the popup (connected, with active case + session) in **dark** and **light**, the disconnected view, and the injected toast. Compare against the app's reskinned window for consistency (zinc surfaces, `#5659f0`/`#6467f2` accent, Inter, flat). Hand to the user for final sign-off.

---

## Self-Review

**Spec coverage:**
- §1 Theme plumbing → Task 1 (status field + type) + Task 3 Steps 2–3 (popup apply + flash script). ✓
- §2 Popup token system → Task 3 Step 1. ✓
- §3 Popup markup → Task 3 Step 4. ✓
- §4 Injected toast → Task 4. ✓
- §5 Fonts → Task 2. ✓
- Verification → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete content. ✓

**Type consistency:** `theme: 'light' | 'dark'` is consistent across `captureServer.ts` (`settings.theme`), `StatusResponse.theme?`, `applyPopupTheme(theme)`, and `status.theme`. Helper named `applyPopupTheme` is defined once (Task 3 Step 3) and called once. ✓
