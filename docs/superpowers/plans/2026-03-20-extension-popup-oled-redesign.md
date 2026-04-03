# Extension Popup OLED Dark Mode Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Chrome extension popup to match the SuperDesign "Birdbrain Extension Popup — OLED Dark Mode" draft, replacing inline styles with a polished, component-driven UI featuring OLED-black surfaces, indigo accents, glow effects, entity highlights, and stats cards.

**Architecture:** The popup is a standalone React app bundled by Vite (`extension/vite.config.ts`). Currently uses inline `style={}` props with no CSS framework. We'll add Tailwind CSS v4 to the extension build (same as the main Electron app), create a dedicated CSS file for custom animations/glow effects, and rewrite `popup.tsx` into a clean component structure. The popup communicates with the Birdbrain desktop app via HTTP API (`extension/src/utils/api.ts`) — that layer stays unchanged.

**Tech Stack:** React 19, Tailwind CSS v4 (`@tailwindcss/vite`), Vite, Chrome Extension Manifest V3

**Design Reference:** `.superdesign/drafts/popup-oled-dark.html` (draft-id: `7fdd2988-d9f2-43a4-b9ef-ae5b6817c3ea`)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `extension/src/popup/popup.css` | Tailwind import, custom animations (fadeUp, pulse-dot, glow keyframes), OLED surface tokens, body sizing |
| Modify | `extension/src/popup/popup.html` | Add Google Fonts link (Plus Jakarta Sans, DM Sans), link popup.css |
| Rewrite | `extension/src/popup/popup.tsx` | Full UI rewrite — header, status card, stats grid, entity highlights, footer actions |
| Modify | `extension/vite.config.ts` | Add `@tailwindcss/vite` plugin to the main (non-content) build config |
| Modify | `extension/src/utils/api.ts` | Add `getEntities()` API call to fetch entity summary for active case |

---

## Design Mapping

The design draft defines these visual sections. Each maps to a region in the rewritten `popup.tsx`:

| Design Section | Popup State | Description |
|---|---|---|
| **Header** | All states | Birdbrain logo (indigo radar icon), title, close button. 48px height, `#0a0e17` bg. |
| **Status Card** | Connected + session active | Recording pill (red pulse dot), current domain, session/case name. Rounded-2xl card with inner glow. |
| **Stats Grid** | Connected (any) | 2-column grid: Captures count (indigo stat-glow), Selectors count. |
| **Entity Highlights** | Connected + has entities | List of entity types (Person, Crypto Wallet, Email, etc.) with colored dots + count badges. |
| **Footer** | All connected states | Primary CTA button (Start/Stop Capture), settings icon, help icon, "Open Full Workspace" link. |
| **Disconnected** | Not connected | Warning state with retry button (not in design draft — keep existing UX, apply new styling). |

### Color Palette (OLED Dark)

| Token | Value | Usage |
|---|---|---|
| `d-body` | `#000000` | Body/page background |
| `d-header` | `#0a0e17` | Header & footer background |
| `d-card` | `#111827` | Card backgrounds |
| `d-border` | `rgba(255,255,255,0.06)` | Subtle borders |
| `d-text` | `#f1f5f9` | Primary text |
| `d-text-secondary` | `#94a3b8` | Secondary/muted text |
| `indigo-500/600` | `#6366f1` / `#4f46e5` | Primary accent, buttons |
| `red-400/500` | `#f87171` / `#ef4444` | Recording indicator |

---

## Tasks

### Task 1: Add Tailwind CSS v4 to Extension Build

**Files:**
- Modify: `extension/vite.config.ts` (add tailwindcss plugin to `mainConfig`)
- Create: `extension/src/popup/popup.css` (tailwind import + custom styles)
- Modify: `extension/src/popup/popup.html` (link CSS, add font imports)

- [ ] **Step 1: Add `@tailwindcss/vite` plugin to extension vite config**

In `extension/vite.config.ts`, import the plugin and add it to `mainConfig.plugins`:

```ts
import tailwindcss from '@tailwindcss/vite'
```

Add `tailwindcss()` to the `plugins` array in `mainConfig` (before the `react()` call):

```ts
const mainConfig = defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // ... existing copy-extension-assets plugin
  ],
  // ... rest unchanged
})
```

- [ ] **Step 2: Create `extension/src/popup/popup.css`**

```css
@import "tailwindcss";

@theme {
  /* OLED Dark surfaces */
  --color-d-body: #000000;
  --color-d-header: #0a0e17;
  --color-d-card: #111827;
  --color-d-card-alt: #1e293b;
  --color-d-border: rgba(255,255,255,0.06);
  --color-d-text: #f1f5f9;
  --color-d-text-secondary: #94a3b8;
  --color-d-text-muted: #64748b;

  /* Accent colors */
  --color-indigo-400: #818cf8;
  --color-indigo-500: #6366f1;
  --color-indigo-600: #4f46e5;
  --color-indigo-700: #4338ca;

  --color-red-400: #f87171;
  --color-red-500: #ef4444;
  --color-amber-500: #f59e0b;
  --color-emerald-500: #22c55e;
  --color-sky-400: #38bdf8;
  --color-yellow-500: #eab308;

  /* Typography */
  --font-display: 'Plus Jakarta Sans', sans-serif;
  --font-body: 'DM Sans', sans-serif;
}

body {
  width: 320px;
  margin: 0;
  overflow: hidden;
  background: var(--color-d-body);
  color: var(--color-d-text);
  font-family: var(--font-body);
}

/* Animations */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.15); }
}

@keyframes btn-glow {
  0%, 100% { box-shadow: 0 4px 20px rgba(79,70,229,0.5), 0 0 40px rgba(79,70,229,0.15); }
  50% { box-shadow: 0 4px 24px rgba(79,70,229,0.6), 0 0 50px rgba(79,70,229,0.25); }
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

.btn-glow-pulse {
  animation: btn-glow 3s ease-in-out infinite;
}

.recording-ring {
  box-shadow: 0 0 8px rgba(239,68,68,0.4), 0 0 16px rgba(239,68,68,0.15);
}

.dark-card-glow {
  box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
}

.stat-glow {
  text-shadow: 0 0 20px rgba(129,140,248,0.5);
}

.entity-dot {
  box-shadow: 0 0 6px currentColor;
}
```

- [ ] **Step 3: Update `popup.html`**

Replace the existing `<head>` content (keep the `<body>` as-is):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=320, initial-scale=1.0" />
    <title>Birdbrain</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./popup.tsx"></script>
  </body>
</html>
```

Remove the old inline `<style>` block entirely — all styling now comes from `popup.css` (imported by `popup.tsx`).

- [ ] **Step 4: Verify Tailwind builds**

Run: `pnpm build:extension`
Expected: Build succeeds, `extension/dist/` contains processed CSS with Tailwind utilities.

- [ ] **Step 5: Commit**

```bash
git add extension/vite.config.ts extension/src/popup/popup.css extension/src/popup/popup.html
git commit -m "feat(extension): add Tailwind CSS v4 to popup build with OLED dark theme tokens"
```

---

### Task 2: Add Entity Summary API

**Files:**
- Modify: `extension/src/utils/api.ts` (add `getEntitySummary` function)

The design shows an "Entity Highlights" section with counts per entity type. We need an API call to fetch this. The main app already has entity data via the `entities` table — the capture server likely exposes or can expose a summary endpoint.

- [ ] **Step 1: Check if entity summary endpoint exists**

Run: `grep -r "entities" src/main/services/captureServer.ts`

Look for a route like `/api/entities` or `/api/cases/:id/entities`. If it exists, note the response shape. If not, we'll need to add one (separate task).

- [ ] **Step 2: Add `getEntitySummary` to API utils**

Add to `extension/src/utils/api.ts`:

```ts
export interface EntityTypeSummary {
  type: string
  count: number
  color: string
}

export async function getEntitySummary(caseId: string): Promise<EntityTypeSummary[]> {
  try {
    return await request(`/api/cases/${caseId}/entities/summary`)
  } catch {
    return []
  }
}
```

> **Note:** If the endpoint doesn't exist yet, this will gracefully return `[]`. A follow-up task can add the server endpoint. The popup UI should handle empty entity data gracefully.

- [ ] **Step 3: Commit**

```bash
git add extension/src/utils/api.ts
git commit -m "feat(extension): add entity summary API helper for popup"
```

---

### Task 3: Rewrite Popup — Header Component

**Files:**
- Modify: `extension/src/popup/popup.tsx`

Start the rewrite by replacing the entire file. This task covers the import block, types, and header section.

- [ ] **Step 1: Write the new file scaffold with header**

Replace `extension/src/popup/popup.tsx` entirely. Start with:

```tsx
import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { getStatus, getCases, activateCase, startSession, stopSession, getEntitySummary } from '@extension/utils/api'
import type { EntityTypeSummary } from '@extension/utils/api'
import './popup.css'

interface CaseInfo {
  id: string
  name: string
  captureCount: number
}

// ---------- Header ----------

function Header() {
  const handleClose = () => window.close()

  return (
    <header className="flex items-center justify-between px-4 h-12 sticky top-0 z-10 bg-d-header border-b border-d-border">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
          </svg>
        </div>
        <span className="font-display font-extrabold text-sm tracking-tight text-white">Birdbrain</span>
      </div>
      <button
        onClick={handleClose}
        className="w-7 h-7 flex items-center justify-center rounded-md text-d-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>
  )
}

// Placeholder main component (will be filled in next tasks)
function Popup(): React.JSX.Element {
  return (
    <div className="flex flex-col w-[320px] font-body bg-d-body text-d-text">
      <Header />
      <main className="p-4">
        <p className="text-d-text-secondary text-sm">Loading...</p>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
)
```

- [ ] **Step 2: Verify it renders**

Run: `pnpm build:extension`
Load the extension in Chrome and click the popup icon. Should see the OLED header with Birdbrain logo and close button.

- [ ] **Step 3: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat(extension): rewrite popup with OLED header component"
```

---

### Task 4: Status Card & Stats Grid

**Files:**
- Modify: `extension/src/popup/popup.tsx`

- [ ] **Step 1: Add StatusCard component**

Add above the `Popup` component:

```tsx
// ---------- Status Card ----------

function StatusCard({
  sessionActive,
  activeCase,
  currentDomain
}: {
  sessionActive: boolean
  activeCase: { id: string; name: string } | null
  currentDomain: string
}) {
  return (
    <section className="animate-fade-up rounded-2xl p-4 bg-d-card border border-d-border dark-card-glow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-d-text-muted">
          Capture Status
        </span>
        {sessionActive ? (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full recording-ring bg-red-500/15 border border-red-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 status-recording" />
            <span className="text-[10px] font-bold text-red-400">Recording</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-bold text-emerald-400">Connected</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/[0.04] border border-d-border text-d-text-muted">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-bold truncate text-white">
            {currentDomain || 'No active tab'}
          </h3>
          <p className="text-[10px] truncate text-d-text-muted">
            {activeCase ? `Session: ${activeCase.name}` : 'No case selected'}
          </p>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add StatsGrid component**

```tsx
// ---------- Stats Grid ----------

function StatsGrid({
  captureCount,
  selectorCount
}: {
  captureCount: number
  selectorCount: number
}) {
  return (
    <section className="animate-fade-up-delay-1 grid grid-cols-2 gap-3">
      <div className="rounded-xl p-3 bg-d-card border border-d-border dark-card-glow">
        <span className="text-[9px] font-bold uppercase block mb-1 text-d-text-muted">Captures</span>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-display font-extrabold text-indigo-400 stat-glow">{captureCount}</span>
          <span className="text-[10px] text-d-text-muted">active</span>
        </div>
      </div>
      <div className="rounded-xl p-3 bg-d-card border border-d-border dark-card-glow">
        <span className="text-[9px] font-bold uppercase block mb-1 text-d-text-muted">Selectors</span>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-display font-extrabold text-white stat-glow">{selectorCount}</span>
          <span className="text-[10px] text-d-text-muted">matching</span>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat(extension): add StatusCard and StatsGrid popup components"
```

---

### Task 5: Entity Highlights Section

**Files:**
- Modify: `extension/src/popup/popup.tsx`

- [ ] **Step 1: Add EntityHighlights component**

```tsx
// ---------- Entity Highlights ----------

const ENTITY_COLORS: Record<string, string> = {
  person: '#f59e0b',
  crypto_wallet: '#eab308',
  email: '#22c55e',
  organization: '#38bdf8',
  phone: '#a78bfa',
  ip_address: '#f87171',
  url: '#818cf8',
  username: '#fb923c'
}

function EntityHighlights({ entities }: { entities: EntityTypeSummary[] }) {
  if (entities.length === 0) return null

  const total = entities.reduce((sum, e) => sum + e.count, 0)

  return (
    <section className="animate-fade-up-delay-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-d-text-muted">
          Entity Highlights
        </h4>
        <span className="text-[10px] font-semibold text-indigo-400">
          {total} detected
        </span>
      </div>
      <div className="rounded-2xl p-3 space-y-2.5 bg-d-card border border-d-border dark-card-glow">
        {entities.map((entity) => {
          const color = entity.color || ENTITY_COLORS[entity.type.toLowerCase()] || '#94a3b8'
          const label = entity.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          return (
            <div key={entity.type} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-2.5 h-2.5 rounded-full entity-dot"
                  style={{ backgroundColor: color, color }}
                />
                <span className="text-[11px] font-medium text-d-text">{label}</span>
              </div>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ color, backgroundColor: `${color}15` }}
              >
                x{entity.count}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat(extension): add EntityHighlights popup component"
```

---

### Task 6: Footer Actions

**Files:**
- Modify: `extension/src/popup/popup.tsx`

- [ ] **Step 1: Add Footer component**

```tsx
// ---------- Footer ----------

function Footer({
  sessionActive,
  activeCase,
  onStartCapture,
  onStopCapture,
  onManualCapture
}: {
  sessionActive: boolean
  activeCase: { id: string; name: string } | null
  onStartCapture: () => void
  onStopCapture: () => void
  onManualCapture: () => void
}) {
  return (
    <footer className="p-4 mt-auto bg-d-header border-t border-d-border">
      <div className="flex gap-2 items-center">
        {sessionActive ? (
          <button
            onClick={onStopCapture}
            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl font-display font-bold text-xs active:scale-[0.98] transition-all bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/25"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop Capture
          </button>
        ) : (
          <button
            onClick={activeCase ? onStartCapture : undefined}
            disabled={!activeCase}
            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl font-display font-bold text-xs active:scale-[0.98] transition-all bg-indigo-600 hover:bg-indigo-500 text-white shadow-dark-btn btn-glow-pulse disabled:opacity-40 disabled:animate-none disabled:shadow-none"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
            </svg>
            Start Capture
          </button>
        )}

        {activeCase && (
          <button
            onClick={onManualCapture}
            className="w-10 h-10 flex items-center justify-center rounded-xl active:scale-[0.98] transition-colors bg-white/[0.04] border border-d-border text-d-text-secondary hover:bg-white/[0.08] hover:text-white"
            title="Capture this page"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        )}

        <button
          onClick={() => chrome.tabs.create({ url: 'http://localhost:19845' })}
          className="w-10 h-10 flex items-center justify-center rounded-xl active:scale-[0.98] transition-colors bg-white/[0.04] border border-d-border text-d-text-secondary hover:bg-white/[0.08] hover:text-white"
          title="Settings"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      <div className="mt-3 text-center">
        <button
          onClick={() => chrome.tabs.create({ url: 'http://localhost:19845' })}
          className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Open Full Workspace
        </button>
      </div>
    </footer>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat(extension): add Footer actions popup component"
```

---

### Task 7: Case Selector for Inactive State

**Files:**
- Modify: `extension/src/popup/popup.tsx`

When connected but no session is active, we need a case selector. The design doesn't show this state explicitly, so we style it to match the OLED card aesthetic.

- [ ] **Step 1: Add CaseSelector component**

```tsx
// ---------- Case Selector ----------

function CaseSelector({
  cases,
  activeCase,
  onSelect
}: {
  cases: CaseInfo[]
  activeCase: { id: string; name: string } | null
  onSelect: (id: string) => void
}) {
  if (cases.length === 0) {
    return (
      <section className="animate-fade-up rounded-2xl p-4 bg-d-card border border-d-border dark-card-glow text-center">
        <p className="text-xs text-d-text-muted mb-1">No cases yet</p>
        <p className="text-[10px] text-d-text-muted">Create one in the Birdbrain app.</p>
      </section>
    )
  }

  return (
    <section className="animate-fade-up">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-d-text-muted mb-2">
        Select Case
      </h4>
      <div className="rounded-2xl overflow-hidden bg-d-card border border-d-border dark-card-glow">
        {cases.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
              activeCase?.id === c.id
                ? 'bg-indigo-600/15 border-l-2 border-l-indigo-500 text-white'
                : 'text-d-text-secondary hover:bg-white/[0.04] hover:text-d-text border-l-2 border-l-transparent'
            }`}
          >
            <span className="text-xs font-medium truncate">{c.name}</span>
            <span className="text-[10px] text-d-text-muted ml-2 shrink-0">{c.captureCount}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat(extension): add CaseSelector popup component"
```

---

### Task 8: Disconnected State

**Files:**
- Modify: `extension/src/popup/popup.tsx`

- [ ] **Step 1: Add DisconnectedView component**

```tsx
// ---------- Disconnected View ----------

function DisconnectedView({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col w-[320px] font-body bg-d-body text-d-text">
      <Header />
      <main className="p-4 flex-1 flex flex-col items-center justify-center py-12">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h2 className="text-sm font-display font-bold text-white mb-1">Birdbrain Not Found</h2>
        <p className="text-[11px] text-d-text-muted mb-6 text-center">
          Make sure the Birdbrain desktop app is running.
        </p>
        <button
          onClick={onRetry}
          className="h-9 px-6 rounded-xl font-display font-bold text-xs bg-indigo-600 hover:bg-indigo-500 text-white shadow-dark-btn btn-glow-pulse active:scale-[0.98] transition-all"
        >
          Retry Connection
        </button>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat(extension): add DisconnectedView popup component"
```

---

### Task 9: Wire Up Main Popup Component

**Files:**
- Modify: `extension/src/popup/popup.tsx`

This task assembles all components into the main `Popup` component with state management.

- [ ] **Step 1: Rewrite the Popup component with full state logic**

Replace the placeholder `Popup` component:

```tsx
function Popup(): React.JSX.Element {
  const [connected, setConnected] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [activeCase, setActiveCase] = useState<{ id: string; name: string } | null>(null)
  const [cases, setCases] = useState<CaseInfo[]>([])
  const [captureCount, setCaptureCount] = useState(0)
  const [activeSelectorCount, setActiveSelectorCount] = useState(0)
  const [currentDomain, setCurrentDomain] = useState('')
  const [entities, setEntities] = useState<EntityTypeSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkStatus()
    // Get current tab domain
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          setCurrentDomain(new URL(tabs[0].url).hostname)
        } catch {
          setCurrentDomain('')
        }
      }
    })
  }, [])

  async function checkStatus(): Promise<void> {
    try {
      const status = await getStatus()
      setConnected(status.running)
      setSessionActive(status.sessionActive)
      setActiveCase(status.activeCase)
      setCaptureCount(status.captureCount)

      if (status.running) {
        const caseList = await getCases()
        setCases(caseList)

        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
          if (state) {
            setActiveSelectorCount(state.activeSelectorCount || 0)
          }
        })

        // Fetch entity summary if there's an active case
        if (status.activeCase) {
          try {
            const entityData = await getEntitySummary(status.activeCase.id)
            setEntities(entityData)
          } catch {
            setEntities([])
          }
        }
      }
    } catch {
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }

  async function handleActivateCase(id: string): Promise<void> {
    const result = await activateCase(id)
    setActiveCase(result.case)
  }

  async function handleStartCapture(): Promise<void> {
    await startSession()
    setSessionActive(true)
    setCaptureCount(0)
  }

  async function handleStopCapture(): Promise<void> {
    await stopSession()
    setSessionActive(false)
    chrome.runtime.sendMessage({ type: 'SESSION_STOPPED' })
  }

  async function handleManualCapture(): Promise<void> {
    if (!activeCase) return
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    chrome.runtime.sendMessage({ type: 'MANUAL_CAPTURE', tabId: tab.id, caseId: activeCase.id })
  }

  // Loading
  if (loading) {
    return (
      <div className="flex flex-col w-[320px] font-body bg-d-body text-d-text items-center justify-center py-16">
        <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 animate-pulse">
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
          </svg>
        </div>
      </div>
    )
  }

  // Disconnected
  if (!connected) {
    return <DisconnectedView onRetry={checkStatus} />
  }

  // Connected
  return (
    <div className="flex flex-col w-[320px] font-body bg-d-body text-d-text">
      <Header />
      <main className="p-4 space-y-3.5">
        {activeCase ? (
          <StatusCard
            sessionActive={sessionActive}
            activeCase={activeCase}
            currentDomain={currentDomain}
          />
        ) : (
          <CaseSelector
            cases={cases}
            activeCase={activeCase}
            onSelect={handleActivateCase}
          />
        )}

        <StatsGrid captureCount={captureCount} selectorCount={activeSelectorCount} />

        <EntityHighlights entities={entities} />
      </main>
      <Footer
        sessionActive={sessionActive}
        activeCase={activeCase}
        onStartCapture={handleStartCapture}
        onStopCapture={handleStopCapture}
        onManualCapture={handleManualCapture}
      />
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual smoke test**

Load the extension in Chrome (`chrome://extensions` → Load unpacked → `extension/dist/`).
Click the extension icon and verify:
1. Header renders with Birdbrain logo (indigo) and close button
2. If Birdbrain desktop is running: status card, stats grid, and footer render
3. If Birdbrain desktop is NOT running: disconnected view with retry button
4. OLED black background (`#000000`) throughout
5. Cards have subtle glow effects
6. Recording state shows red pulse indicator
7. Buttons have indigo glow animation

- [ ] **Step 4: Commit**

```bash
git add extension/src/popup/popup.tsx
git commit -m "feat(extension): wire up full OLED popup with all components"
```

---

### Task 10: Add Entity Summary Endpoint (Server-Side)

**Files:**
- Modify: `src/main/services/captureServer.ts` (add `/api/cases/:id/entities/summary` route)
- Modify: `src/main/services/database.ts` (add query method if needed)

> This task ensures the popup's Entity Highlights section has real data. If the endpoint already exists, skip this task.

- [ ] **Step 1: Check existing entity routes**

Run: `grep -n "entities" src/main/services/captureServer.ts`

- [ ] **Step 2: Add entity summary route to capture server**

Add a new GET route to the Hono server:

```ts
app.get('/api/cases/:id/entities/summary', (c) => {
  const caseId = c.req.param('id')
  const rows = db.getDb().prepare(`
    SELECT type, COUNT(*) as count
    FROM entities
    WHERE capture_id IN (SELECT id FROM captures WHERE case_id = ?)
    GROUP BY type
    ORDER BY count DESC
  `).all(caseId) as { type: string; count: number }[]

  return c.json(rows.map(r => ({
    type: r.type,
    count: r.count,
    color: ''
  })))
})
```

- [ ] **Step 3: Verify endpoint**

Run: `pnpm dev` (start the app), then in another terminal:

```bash
curl http://127.0.0.1:19845/api/cases/test/entities/summary
```

Expected: JSON array (empty `[]` if no entities for that case, which is fine).

- [ ] **Step 4: Commit**

```bash
git add src/main/services/captureServer.ts
git commit -m "feat(server): add entity summary endpoint for extension popup"
```

---

## Summary

| Task | What it does | Files touched |
|------|-------------|---------------|
| 1 | Add Tailwind CSS to extension build | `vite.config.ts`, `popup.css` (new), `popup.html` |
| 2 | Add entity summary API helper | `api.ts` |
| 3 | Header component | `popup.tsx` |
| 4 | StatusCard + StatsGrid | `popup.tsx` |
| 5 | EntityHighlights | `popup.tsx` |
| 6 | Footer actions | `popup.tsx` |
| 7 | CaseSelector (idle state) | `popup.tsx` |
| 8 | DisconnectedView | `popup.tsx` |
| 9 | Wire up main Popup + smoke test | `popup.tsx` |
| 10 | Server-side entity summary endpoint | `captureServer.ts` |
