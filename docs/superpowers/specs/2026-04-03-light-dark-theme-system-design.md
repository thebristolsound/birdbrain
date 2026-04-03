# Light/Dark Theme System Design

## Overview

Add a full light/dark theme system to Birdbrain. The app is currently dark-mode-only with hardcoded colors across ~35 components. This design introduces semantic CSS custom properties via Tailwind v4's `@theme` directive, enabling both light and dark modes with a toggle. Light mode becomes the new default.

## Approach

**Semantic CSS Variables in `@theme`** — define ~13 semantic color tokens plus ~4 shadow tokens in `globals.css`. Light values are the `:root` defaults. Dark values override via `html.dark` selector. Components reference semantic Tailwind classes (`bg-surface`, `text-primary`, `border-border`) — never raw colors. Entity type colors (amber, sky, green, etc.) remain raw since they're identical in both modes.

## Token System

### Surface Hierarchy (4 levels)

| Token | Tailwind Class | Light | Dark (OLED) | Purpose |
|---|---|---|---|---|
| `--color-canvas` | `bg-canvas` | `#f4f5f7` | `#000000` | Page background |
| `--color-surface` | `bg-surface` | `#f8fafb` | `#0f172a` | Sidebar, panels |
| `--color-card` | `bg-card` | `#ffffff` | `#1e293b` | Cards, dialogs |
| `--color-elevated` | `bg-elevated` | `#ffffff` | `#273548` | Dropdowns, menus |

### Text Hierarchy (4 levels)

| Token | Tailwind Class | Light | Dark |
|---|---|---|---|
| `--color-text-primary` | `text-primary` | `#1e293b` | `#f1f5f9` |
| `--color-text-secondary` | `text-secondary` | `#475569` | `#cbd5e1` |
| `--color-text-muted` | `text-muted` | `#64748b` | `#94a3b8` |
| `--color-text-faint` | `text-faint` | `#94a3b8` | `#475569` |

### Accent (3 levels)

| Token | Tailwind Class | Light | Dark |
|---|---|---|---|
| `--color-accent` | `bg-accent` / `text-accent` | `#4f46e5` | `#818cf8` |
| `--color-accent-hover` | `hover:bg-accent-hover` | `#4338ca` | `#6366f1` |
| `--color-accent-subtle` | `bg-accent-subtle` | `#eef2ff` | `rgba(79,70,229,0.15)` |

### Borders (2 levels)

| Token | Tailwind Class | Light | Dark |
|---|---|---|---|
| `--color-border` | `border-border` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` |
| `--color-border-strong` | `border-border-strong` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.12)` |

### Shadow Tokens

| Token | Light | Dark |
|---|---|---|
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02)` | `0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3)` |
| `--shadow-card-hover` | `0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)` | `0 2px 12px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.4)` |
| `--shadow-glow` | `0 4px 12px rgba(79,70,229,0.25)` | `0 0 20px rgba(99,102,241,0.25), 0 0 60px rgba(99,102,241,0.08)` |
| `--shadow-btn` | `0 4px 12px rgba(79,70,229,0.25)` | `0 4px 20px rgba(99,102,241,0.4), 0 0 40px rgba(99,102,241,0.12)` |

### Entity Type Colors (unchanged, same in both modes)

Person amber `#f59e0b`, Org sky `#38bdf8`, Email green `#22c55e`, Domain pink `#ec4899`, Crypto yellow `#eab308`, IP red `#ef4444`, Address teal `#14b8a6`, Date orange `#f97316`, Username indigo `#6366f1`, Phone purple `#a855f7`.

## CSS Architecture

### globals.css Structure

```css
@import "tailwindcss";
@import "@fontsource-variable/plus-jakarta-sans";
@import "@fontsource-variable/dm-sans";
@import "@fontsource-variable/jetbrains-mono";

@theme {
  /* Semantic tokens — light mode defaults */
  --color-canvas: #f4f5f7;
  --color-surface: #f8fafb;
  --color-card: #ffffff;
  --color-elevated: #ffffff;
  --color-text-primary: #1e293b;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;
  --color-text-faint: #94a3b8;
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-accent-subtle: #eef2ff;
  --color-border: rgba(0,0,0,0.04);
  --color-border-strong: rgba(0,0,0,0.08);

  /* Raw palette — entity types, status indicators */
  --color-indigo-300: #a5b4fc;
  --color-indigo-400: #818cf8;
  /* ... (keep existing raw palette) ... */

  /* Fonts (unchanged) */
  --font-display: "Plus Jakarta Sans Variable", sans-serif;
  --font-body: "DM Sans Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
}

/* Dark mode overrides */
html.dark {
  --color-canvas: #000000;
  --color-surface: #0f172a;
  --color-card: #1e293b;
  --color-elevated: #273548;
  --color-text-primary: #f1f5f9;
  --color-text-secondary: #cbd5e1;
  --color-text-muted: #94a3b8;
  --color-text-faint: #475569;
  --color-accent: #818cf8;
  --color-accent-hover: #6366f1;
  --color-accent-subtle: rgba(79,70,229,0.15);
  --color-border: rgba(255,255,255,0.06);
  --color-border-strong: rgba(255,255,255,0.12);
}

/* Smooth theme transition */
html.transitioning,
html.transitioning * {
  transition: background-color 0.4s ease, color 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease !important;
}

body {
  @apply bg-canvas text-secondary;
  font-family: var(--font-body);
}

/* Scrollbar — light default */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
html.dark ::-webkit-scrollbar-thumb { background: #334155; }
html.dark ::-webkit-scrollbar-thumb:hover { background: #475569; }
```

### Custom CSS Classes (dual-mode)

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

.glow-indigo {
  box-shadow: var(--shadow-glow);
}
.glow-indigo-btn {
  box-shadow: var(--shadow-btn);
}
```

Shadow tokens are defined as regular CSS custom properties (not in `@theme` since Tailwind doesn't generate shadow utilities from `@theme`):

```css
:root {
  --shadow-card: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02);
  --shadow-card-hover: 0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04);
  --shadow-glow: 0 4px 12px rgba(79,70,229,0.25);
  --shadow-btn: 0 4px 12px rgba(79,70,229,0.25);
}
html.dark {
  --shadow-card: 0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3);
  --shadow-card-hover: 0 2px 12px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.4);
  --shadow-glow: 0 0 20px rgba(99,102,241,0.25), 0 0 60px rgba(99,102,241,0.08);
  --shadow-btn: 0 4px 20px rgba(99,102,241,0.4), 0 0 40px rgba(99,102,241,0.12);
}
```

### Decorative Classes (light variants)

```css
.shimmer-text {
  background: linear-gradient(90deg, #4f46e5 0%, #6366f1 25%, #4f46e5 50%, #818cf8 75%, #4f46e5 100%);
  /* ... existing clip/animation ... */
}
html.dark .shimmer-text {
  background: linear-gradient(90deg, #818cf8 0%, #c7d2fe 25%, #818cf8 50%, #a5b4fc 75%, #818cf8 100%);
}

.grid-bg {
  background-image:
    radial-gradient(circle at 50% 0%, rgba(79,70,229,0.06) 0%, transparent 50%),
    linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
  background-size: 100% 100%, 48px 48px, 48px 48px;
}
html.dark .grid-bg {
  background-image:
    radial-gradient(circle at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 50%),
    linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 100% 100%, 48px 48px, 48px 48px;
}

.logo-pulse {
  position: relative;
  animation: glow-pulse 3s ease-in-out infinite, float 4s ease-in-out infinite;
}
/* glow-pulse keyframes use --shadow-glow so they adapt automatically */

.step-connector {
  height: 2px;
  background: linear-gradient(90deg, rgba(79,70,229,0.3), rgba(79,70,229,0.1));
}

.new-case-card {
  border-color: rgba(79,70,229,0.2);
  background: rgba(79,70,229,0.04);
}
.new-case-card:hover {
  border-color: rgba(79,70,229,0.4);
  background: rgba(79,70,229,0.08);
}
html.dark .new-case-card {
  border-color: rgba(99,102,241,0.3);
  background: rgba(99,102,241,0.05);
}
html.dark .new-case-card:hover {
  border-color: rgba(99,102,241,0.5);
  background: rgba(99,102,241,0.1);
}
```

## Theme Toggle & State Management

### useTheme Hook

New file: `src/renderer/hooks/useTheme.ts`

```typescript
function useTheme() {
  // Reads from localStorage on mount, defaults to 'light'
  // Returns: { theme: 'light' | 'dark', toggleTheme: () => void }
  // toggleTheme():
  //   1. Adds 'transitioning' class to <html>
  //   2. Toggles 'dark' class on <html>
  //   3. Writes to localStorage
  //   4. Calls IPC settings:update to persist { theme }
  //   5. Removes 'transitioning' class after 400ms
}
```

### Flash Prevention

In `src/renderer/index.html`, add inline script before any CSS/JS loads:

```html
<script>
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark')
  }
</script>
```

### TopBar Integration

Add a Sun/Moon toggle button in the TopBar header, positioned before the Settings gear icon. Uses `useTheme` hook. Icon transitions with 0.3s rotate effect.

### AppearanceConfig Update

Enable the Light/Dark buttons (remove `disabled`). Active button shows indigo border. Calls `useTheme().toggleTheme()` on click. Remove "(coming soon)" labels.

## Component Migration

### Migration Pattern

Every hardcoded dark color class becomes its semantic equivalent:

| Current | Becomes |
|---|---|
| `bg-black`, `bg-slate-900` | `bg-canvas` or `bg-surface` |
| `bg-slate-800`, `bg-white/[0.03]` | `bg-card` or `bg-elevated` |
| `text-white`, `text-slate-50` | `text-primary` |
| `text-slate-300`, `text-slate-200` | `text-secondary` |
| `text-slate-400`, `text-slate-500` | `text-muted` |
| `text-slate-600`, `text-slate-700` | `text-faint` |
| `border-white/[0.06]`, `border-slate-800` | `border-border` |
| `border-white/[0.08]`, `border-slate-700` | `border-border-strong` |
| `bg-indigo-600` (accent) | `bg-accent` |
| `hover:bg-indigo-500` | `hover:bg-accent-hover` |
| `bg-indigo-500/10`, `bg-indigo-950/50` | `bg-accent-subtle` |
| `hover:bg-white/[0.04]`, `hover:bg-slate-800` | `hover:bg-elevated` |

### Migration Groups

**Simple (color swaps only, ~20 components):**
TopBar, CaptureList, CaptureItem, SearchBar, SessionControls, ConnectionStatus, CaptureHealth, TagBadge, TagManager, SelectorTable, SelectorTableRow, SelectorFilterFooter, CreateSelectorCard, SelectorsOverview, ExportDialog, SettingsView, StorageConfig, AIConfig, CapturePreferences, About

**Medium (color swaps + custom class updates, ~10 components):**
CaseCard, CaseOverview, CaseSwitcher, CaseWorkspace, CreateCaseDialog, NewCaseWizard, Dashboard, RecentCases, ExtensionBanner, DashboardFooter

**Complex (need light-mode visual rethinking, ~5 components):**
HeroSection (shimmer, logo pulse, grid bg), QuickStartGuide (step connectors, decorations), AppearanceConfig (functional toggle), TopBar (theme toggle button), CaptureViewer (contrast for content area)

### Unchanged

- Entity badge colors — same in both modes
- Status indicators (red recording pulse, green active dot) — same in both modes
- Lucide icons — inherit `currentColor` from text tokens

## Out of Scope

- System preference / `prefers-color-scheme` auto-detection
- Third theme options (high contrast, etc.)
- Chrome extension theming
- New components or layout changes
- Font changes

## Testing

- Visual check: every page in light mode, every page in dark mode
- Toggle: smooth transition, no flash on reload
- Persistence: theme survives app restart
- Edge cases: context menus, dropdowns, hover states all respect theme
- E2E: add theme toggle test to existing Playwright suite
