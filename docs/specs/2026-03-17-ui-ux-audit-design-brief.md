# Birdbrain UI/UX Audit & Design Brief

## Context
Birdbrain is an open-source web investigation & capture tool built as an Electron + React desktop app with a companion Chrome extension. It enables investigators to capture web pages, extract entities (people, emails, domains, etc.), tag/organize findings, and perform analysis with AI models. The current UI is functional but utilitarian — it needs a complete overhaul for simplicity and modern minimalist flair while preserving all existing functionality.

---

## Current Application Architecture

### Platform
- **Desktop**: Electron app (React 19 + Tailwind v4 + Zustand)
- **Browser**: Chrome extension (popup + content script sidebar + page highlights)
- **Data**: SQLite database, file-based capture storage

### Navigation Model
Two-level flat hierarchy:
1. **Dashboard** → Landing page with case list
2. **Case Workspace** → 5-tab interface (Overview, Captures, Entities, Analysis, Selectors)
3. **Settings** → Overlay panel (AI config, entity extraction, capture prefs, storage, about)

No routing library — view switching is state-driven via Zustand store (`appMode`, `activeCaseTab`, `settingsOpen`).

---

## Current Design System

### Color Palette
- **Background**: neutral-950 (#0a0a0a) base, neutral-900 (#171717) cards
- **Text**: neutral-100 (#f5f5f5) primary → neutral-500 (#737373) secondary
- **Primary accent**: Amber (#f59e0b) — CTAs, highlights, active states
- **Status**: Green (#22c55e) connected, Red (#ef4444) recording/danger, Blue (#3b82f6) active tabs
- **Entity type colors**: 11 distinct colors for graph visualization (amber=person, blue=org, green=email, purple=phone, pink=domain, red=IP, teal=address, orange=date, indigo=username, yellow=crypto, gray=custom)

### Typography
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- No custom fonts, default Tailwind sizing
- Monospace used for: URLs, patterns, selectors, code

### Icons
- **No icon library** — hand-coded SVG paths + Unicode characters (⚙, ⋮, ×, ←, →)
- Extension popup uses emoji (⚠️)

### Components
- No component library — everything custom-built with Tailwind utility classes
- Custom scrollbars (6px, neutral-700 thumb)
- Minimal shadows, minimal animation (only pulse on recording dot, toggle switch transitions)

---

## Screen-by-Screen Breakdown

### 1. Dashboard (Landing Page)

**Current state**: Simple centered column (max-w-2xl) with:
- Title "Birdbrain" (amber) + subtitle
- Extension connection status card (green/neutral border)
- 3 stat cards in a grid (cases, captures, storage)
- "New Case" button → opens modal dialog
- Recent cases list (up to 5) with inline rename, kebab menu (⋮), delete confirmation

**Pain points for redesign**:
- Very static — no visual hierarchy beyond the title
- Stats feel disconnected from the case list
- Limited to 5 recent cases — no way to see all or search/filter
- Case cards are bland with minimal information density
- Create case is a basic modal with just name/description fields
- No onboarding flow for new users

### 2. Case Workspace — Overview Tab

**Current state**: Editable name/description, stats grid (captures/domains/entities counts), action buttons (Analyze, Export), top domains list, capture timeline bar chart.

**Pain points**:
- Click-to-edit on name/description is not discoverable
- Timeline is a basic amber bar chart with no interactivity
- Top domains list is plain text
- No visual connection between stats and the underlying data

### 3. Case Workspace — Captures Tab (Main Workhorse)

**Current state**: 30/70 split view:
- **Left panel**: Scrollable capture list showing title + hostname + timestamp
- **Right panel**: Capture viewer with 6 sub-tabs (Screenshot, Page, Source, Text, Metadata, Entities) + prev/next navigation + tag bar at bottom

**Pain points**:
- The capture list items are very sparse — just title and hostname, no visual preview
- 6 sub-tabs within an already-tabbed interface creates navigation depth
- Screenshot tab just shows the raw image — no zoom, no annotation
- Page tab renders HTML in a sandboxed iframe — can be jarring
- Source tab is raw HTML in a `<pre>` block — no syntax highlighting
- Tag management is a small "+" button at the bottom — easy to miss
- No bulk operations (multi-select, bulk tag, bulk delete)
- No way to compare captures side-by-side
- Prev/Next navigation buttons are the only way to navigate between captures
- The selector filter bar appears conditionally above the capture list — can be confusing

### 4. Case Workspace — Entities Tab

**Current state**: Table view with filters (type dropdown, source dropdown, confidence slider). Rows show: value, type badge, source badge (rule/AI), confidence, capture count. Clickable rows expand to show source captures.

**Pain points**:
- Table-only view — no visual grouping or clustering
- Filters are basic dropdowns with no visual feedback
- Expandable rows lack a visual interaction cue
- No entity search within the table
- No way to merge/link duplicate entities
- Confidence values are just numbers — no visual indicator in table view

### 5. Case Workspace — Analysis Tab

**Current state**: "Analyze Case" button triggers AI analysis. Shows:
- **Entity Graph**: D3 force-directed graph with colored nodes (sized by occurrence), gray edges
- **Entity Timeline**: Horizontal bar chart showing entity lifespans
- **Insights Panel**: AI-generated summary, clusters, timeline observations, suggestions

**Pain points**:
- Graph has no controls (zoom, pan, filter by type)
- Graph tooltip is basic (positioned at fixed top-left corner)
- Timeline only shows top 20 entities — no scrolling or filtering
- Insights panel is wall-of-text with minimal formatting
- No way to interact with analysis results (click entity in graph → filter captures)
- Analysis must be triggered manually each time

### 6. Case Workspace — Selectors Tab

**Current state**: Create form (pattern input + label + regex checkbox) + table of selectors (pattern, type badge, label, match count, enabled toggle, delete). Clicking a selector adds it as a filter that cross-filters the captures tab.

**Pain points**:
- The relationship between selectors and capture filtering is not intuitive
- Create form is collapsible but lacks a visual cue for that action
- Match counts are just numbers — no preview of what matched
- No visual testing/preview of a pattern before creating it
- Cross-filtering state is not visually connected to the captures tab

### 7. Settings View

**Current state**: 5 sections stacked vertically:
- **AI Config**: API key input + test button + model selector + auto-extract toggle
- **Entity Extraction**: 2-column grid of entity type toggles (regex vs NLP types) + confidence slider
- **Capture Preferences**: Screenshot/HTML toggles, dedupe window slider, ignored URLs, auto-capture mode
- **Storage**: Read-only path display + max storage input
- **About**: Version, description, links

**Pain points**:
- All settings on one long page — no categorization or search
- API key management is bare-bones
- Entity type configuration has no explanations of what each type catches
- No visual feedback for settings changes (save is automatic but not confirmed)

### 8. Chrome Extension — Popup (320px wide)

**Current states**:
- Loading → "Loading..."
- Disconnected → Warning emoji + "Birdbrain not found" + retry button
- Connected (inactive) → Green status + case selector dropdown + "Capture This Page" + "Start Auto-Capture"
- Recording → Red indicator + active case info + capture count + selectors count + capture/stop buttons

**Pain points**:
- Very text-heavy for a popup
- Case selection requires knowing which case to use
- No visual indication of what will be captured
- No capture history in the popup
- No quick-action patterns (right-click capture, keyboard shortcuts)

### 9. Chrome Extension — Content Script Sidebar (320px)

**Current state**: Fixed right-side panel showing selector matches grouped by case. Each match shows pattern, matched text (highlighted amber), and context. Collapsible to a floating amber badge with match count.

**Pain points**:
- 320px sidebar pushes page content — can break page layouts
- Sidebar styling is all inline JS (not Tailwind) — separate design system
- No way to resize the sidebar
- Matches are text-only — no visual connection to where on the page the match occurred

### 10. Chrome Extension — Page Highlights

**Current state**: Matched text highlighted with amber background + amber underline via injected CSS class.

---

## User Flows & Interactions

### Flow 1: First Launch (New User)
1. Open app → Dashboard with "Extension not connected" status
2. No cases exist → Empty state with "New Case" button
3. Must manually install Chrome extension and connect
4. **Gap**: No guided onboarding, no explanation of the tool's workflow

### Flow 2: Starting an Investigation
1. Dashboard → Click "New Case" → Modal (name + description) → Create
2. Auto-navigated to Case Workspace (Overview tab)
3. Connect Chrome extension → Status turns green
4. Select case in Session Controls dropdown → Toggle auto-capture on
5. **Gap**: Many steps to go from "new case" to "actively capturing"

### Flow 3: Browsing & Capturing
1. Browse web with extension connected and auto-capture on
2. Captures stream in real-time (event:newCapture)
3. Switch to Captures tab → Select capture → View screenshot/source/text
4. Tag captures using the bottom tag bar
5. **Gap**: No visual notification of new captures in the Electron app, no capture preview toast

### Flow 4: Entity Extraction & Analysis
1. Go to capture → Entities sub-tab → Click "Extract Entities"
2. Wait for extraction → View entity list with type/confidence/source
3. Go to Entities tab → See aggregated entities across all captures
4. Go to Analysis tab → Click "Analyze Case" → Wait for AI
5. View graph, timeline, insights
6. **Gap**: No way to go from entity → related captures → other entities (no drill-through)

### Flow 5: Using Selectors for Pattern Matching
1. Go to Selectors tab → Create a selector (regex or string pattern)
2. Selector shows match count across case captures
3. Click selector → Adds to filter bar → Captures tab shows only matching captures
4. Chrome extension sidebar shows real-time matches on current page
5. **Gap**: Pattern creation has no live preview, filter state is hard to discover

### Flow 6: Exporting
1. Case Overview → Click "Export" → Modal with format/include options
2. Select HTML or PDF, toggle content sections, enter investigator name
3. Export generates report to disk
4. **Gap**: No preview of the export, no template selection, no sharing

---

## Nuanced Interactions to Preserve

### Real-time Data Flow
- Captures arrive asynchronously from the Chrome extension via HTTP to a local Hono server
- The `event:newCapture` event pushes new captures to the renderer in real-time
- Session state changes (start/stop recording) sync between extension and app
- Extension connection status is monitored continuously

### Inline Editing
- Case names are click-to-edit on both Dashboard and Workspace header
- Case descriptions are click-to-edit on Overview tab
- These use controlled inputs with Enter to save, Escape to cancel

### Cross-Component State
- **Selector filters** set in the Selectors tab affect what's shown in the Captures tab
- The `SelectorFilterBar` appears conditionally in the Captures tab when filters are active
- `filteredCaptureIds` in the store gates which captures are displayed
- Clearing filters restores the full capture list

### Content Loading
- Capture content (HTML, PNG, text) is loaded on-demand via `getContent(captureId, type)`
- Screenshots are base64-encoded PNG strings
- HTML is rendered in a sandboxed iframe
- Text is pre-extracted plain text

### Tag System
- Tags are global (not per-case) with name + color
- Tags are associated to captures via a junction table
- Tag colors use hex values with 20% opacity backgrounds
- Available colors: amber, red, green, blue, purple, pink, teal, orange (8 swatches)

### Entity Aggregation
- The Entities tab aggregates entities across ALL captures in a case
- Entities are deduplicated by value+type combination
- Each aggregated entity tracks which captures it appeared in
- Clicking an aggregated entity shows the source captures

### D3 Force Graph
- Nodes are entities, edges are co-occurrence relationships
- Node size scales with occurrence count
- Edge width scales with relationship weight (co-occurrence frequency)
- Hover shows tooltip with entity details
- Legend shows which entity types are present
- Colors are fixed per entity type (consistent across all visualizations)

### Extension ↔ App Communication
- Extension popup makes HTTP requests to `127.0.0.1:19845` (Hono capture server)
- Session control (start/stop auto-capture, select case) goes through this HTTP API
- Captures are POSTed to the server with page data
- Connection status is monitored and reflected in both the extension popup and the app's TopBar

### Hash Verification
- Each capture gets a SHA-256 hash on storage
- Verification can check stored vs computed hash
- Status: verified | tampered | missing
- Important for investigation integrity — must be preserved

### Auto-Capture Modes
- `auto`: Capture everything while session is active
- `notify`: Notify before capturing (not fully implemented in UI)
- `per-case`: Only capture for the active case

---

## Data Model Summary (for Designer Context)

| Entity | Key Fields | Relationships |
|--------|-----------|---------------|
| **Case** | name, description, archived, timestamps | Has many Captures, Selectors |
| **Capture** | url, title, htmlPath, screenshotPath, hash, timestamp | Belongs to Case, has many Tags (via junction), has many Entities |
| **Tag** | name, color | Many-to-many with Captures |
| **Entity** | type (11 types), value, confidence, source (rule/ai) | Belongs to Capture |
| **Selector** | pattern, isRegex, enabled, label | Belongs to Case, matches against Captures |
| **Analysis** | graph (nodes+edges), clusters, timeline, suggestions, summary | Belongs to Case |

---

## Design Constraints & Considerations

1. **Electron window** — full desktop app, not responsive web. Design for 1280px+ widths.
2. **Chrome extension popup** — fixed 320px width, constrained height.
3. **Content script sidebar** — overlays on arbitrary web pages, must not break page layouts.
4. **Dark theme is primary** — the tool is used for extended investigation sessions.
5. **Information density matters** — investigators need to see many captures/entities at once.
6. **Real-time updates** — captures arrive asynchronously, UI must handle live data gracefully.
7. **Cross-component filtering** — selectors filter captures across tabs, state must be visible.
8. **D3 visualization** — entity graph and timeline use D3.js, can be restyled but the rendering approach stays.
9. **Investigation integrity** — hash verification and audit trails are non-negotiable features.
10. **Accessibility** — current app has basic ARIA labels, keyboard support for modals/forms.

---

## Verification

To test the current UI:
1. `pnpm install` then `pnpm dev` to launch the Electron app
2. `pnpm dev:extension` then load `extension/dist` in Chrome as unpacked extension
3. Create a case, connect extension, enable auto-capture, browse pages
4. View captures, extract entities, run analysis, create selectors, export
