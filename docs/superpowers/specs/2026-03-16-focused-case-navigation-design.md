# Focused Single-Case Navigation Redesign

## Problem

The current UI allows jumping between cases, captures, tags, selectors, and analysis views in a way that feels confusing and disjointed. The sidebar mixes global and case-specific concerns, and selecting a case doesn't create a clear workspace boundary.

## Goal

Only one case is visible at a time. When a case is selected, the full UI space becomes a dedicated workspace for that case. Navigation is clear, hierarchical, and focused.

## Design

### Top-Level Navigation Model

The app has two primary modes plus a settings overlay:

1. **Dashboard mode** — No case selected. Landing page showing all cases as cards, recent activity, extension connection status, and quick actions (create case, start session).

2. **Case workspace mode** — A single case is selected. The entire content area becomes a dedicated workspace with a horizontal tab bar for navigating case sub-sections.

3. **Settings** — Rendered as a full-screen overlay (modal) that does not change `appMode`. The settings gear icon toggles a `settingsOpen: boolean` flag. Closing settings returns to whatever was underneath (dashboard or case workspace) with no state loss.

### Top Bar

The top bar adapts based on the current mode:

**Dashboard mode:**
- Left: App logo/name
- Right: Search bar, session controls, connection status, settings gear

**Case workspace mode:**
- Left: Back arrow (returns to dashboard) + case name (read-only display) + dropdown chevron (opens case switcher to jump directly to another case)
- Right: Search bar, session controls, connection status, settings gear

The **case switcher dropdown** lists all cases and allows direct navigation without returning to the dashboard first.

### Sidebar Removal

The sidebar is eliminated entirely. Its responsibilities are redistributed:

| Current sidebar element | New location |
|------------------------|--------------|
| Case list | Dashboard (case cards) + CaseSwitcher dropdown |
| Capture list | Captures tab (left panel of master-detail split) |
| Tag list | Inline within captures and entities |
| Selectors button | Selectors tab within case workspace |

### Case Workspace Layout

When a case is selected, the main area shows:

**Case header:** Case name (editable inline via click-to-edit), description (read-only in header; editable in Overview tab), date range (first/last capture), recording indicator (pulsing red dot when session is active for this case).

**Tab bar** immediately below the header:

| Tab | Content |
|-----|---------|
| **Overview** | Case stats (capture count, entity count, top domains), capture timeline chart, editable case name and description fields |
| **Captures** | Master-detail split — scrollable capture list on left (~30% width), selected capture detail on right (~70%) with sub-tabs (Screenshot, HTML, Text, Metadata, Entities). Tag management inline on each capture. |
| **Entities** | Case-wide entity table. Filterable by type, source (rule vs AI), confidence threshold. Click an entity to see which captures it appears in. |
| **Analysis** | Entity graph visualization, entity timeline, AI insights panel. "Run Analysis" button. |
| **Selectors** | Case-scoped selector management — create, edit, toggle, delete selectors for this case. |

**Default tab:** Overview when first entering a case.

**Tab persistence:** Tab selection persists when switching cases via the dropdown (e.g., if on Captures tab and you switch cases, you stay on Captures tab).

### Captures Tab: Master-Detail Split

The Captures tab uses a side-by-side layout with a **fixed** split (not draggable/resizable):

- **Left panel (~30%):** Scrollable list of captures for the case, showing title, URL, timestamp, and tag badges. Click to select.
- **Right panel (~70%):** Full capture detail with the existing sub-tab system (Screenshot, HTML, Text, Metadata, Entities). Tag add/remove controls. Previous/next navigation arrows.

When no capture is selected, the right panel shows an empty state prompting the user to select a capture from the list.

### Entities Tab: Case-Wide View

A new view that aggregates all entities across all captures in the case:

- Filterable/sortable table with columns: Entity value, Type, Source (Rule/AI badge), Confidence, Capture count
- Filter controls: Type dropdown, source toggle, confidence threshold slider
- Click an entity row to expand and see which captures it appears in
- Clicking a capture link within the expanded entity row navigates to that capture: sets `activeCaseTab: 'captures'` and `selectedCaptureId` to the clicked capture
- This extends the per-capture entity display into a case-wide aggregation

**Note:** The Source column shows "AI" for entities from AI extraction and "Rule" for entities from rule-based extraction. If rule-based extraction is not yet available, the column gracefully shows only "AI" badges. The filter toggle should hide the source filter when only one source type exists.

### Cross-Tab Navigation

When the user needs to navigate to a specific capture from outside the Captures tab (e.g., clicking a capture link in the Entities tab, or from search results), the action is:

1. Set `activeCaseTab: 'captures'`
2. Set `selectedCaptureId` to the target capture

This is encapsulated in a single store action: `navigateToCapture(captureId)`.

Similarly, if a new capture arrives via the `event:newCapture` channel while the user is in the case workspace, the capture list updates in the background. No automatic tab switch — the user stays on their current tab.

## Zustand Store Changes

### State Shape

```typescript
// Remove
activeView: 'dashboard' | 'case-overview' | 'capture-viewer' | 'case-analysis' | 'selectors-overview' | 'settings'
sidebarCollapsed: boolean

// Add
appMode: 'dashboard' | 'case-workspace'
activeCaseTab: 'overview' | 'captures' | 'entities' | 'analysis' | 'selectors'
settingsOpen: boolean
```

**Initial values:** `appMode: 'dashboard'`, `activeCaseTab: 'overview'`, `settingsOpen: false`.

`activeCaseId` and `selectedCaptureId` are unchanged.

### Actions

| Action | Behavior |
|--------|----------|
| `selectCase(id)` | Set `appMode: 'case-workspace'`, `activeCaseId: id`. Keep current `activeCaseTab`. Clear `selectedCaptureId`. |
| `goToDashboard()` | Set `appMode: 'dashboard'`. Clear `activeCaseId` and `selectedCaptureId`. |
| `setActiveTab(tab)` | Set `activeCaseTab` to the given tab. |
| `selectCapture(id)` | Set `selectedCaptureId`. No mode/tab change — used within the Captures tab. |
| `navigateToCapture(id)` | Set `activeCaseTab: 'captures'` and `selectedCaptureId: id`. Used for cross-tab navigation (entity click-through, search results). |
| `toggleSettings()` | Toggle `settingsOpen`. Does not change `appMode` or any case state. |

### Recording Sessions and Case Switching

Recording sessions are **case-scoped** — `sessionActive` is tied to `activeCaseId`. The recording indicator (pulsing red dot) appears in the case workspace header only for the case that owns the active session.

When switching cases via the dropdown while a session is recording:
- The session **continues running** for the original case (captures from the extension are still routed to that case by the capture server).
- The case switcher dropdown shows a recording indicator dot next to the case that has an active session.
- No warning/blocking — the user can freely browse other cases while recording continues.

## Component Changes

### New Components

| Component | Purpose |
|-----------|---------|
| `CaseWorkspace.tsx` | Wraps case header + tab bar + tab content panel. Main layout for case mode. |
| `CaseSwitcher.tsx` | Dropdown in top bar for jumping between cases without returning to dashboard. |
| `CaseEntities.tsx` | Case-wide entity aggregation table with filters. New view for the Entities tab. |

### Modified Components

| Component | Changes |
|-----------|---------|
| `TopBar.tsx` | Conditional rendering: logo in dashboard mode; back button + case name + switcher dropdown in case mode. Settings gear toggles `settingsOpen` overlay. |
| `MainContent.tsx` | Simplified switch between `Dashboard` and `CaseWorkspace` based on `appMode`. Settings rendered as overlay when `settingsOpen` is true. |
| `CaptureViewer.tsx` | Adapted to work in the right panel of a master-detail split (no longer a full-page view). Remove any direct `activeView` references. |
| `CaptureList.tsx` | Modified to work as the left panel of the master-detail split in the Captures tab. Layout changes from vertical sidebar list to panel list. |
| `CaptureItem.tsx` | Minor styling adjustments for the wider panel context. |
| `CaseOverview.tsx` | Adapted to serve as the Overview tab content. Remove selectors section (moved to Selectors tab). Add editable case name/description fields. |
| `SelectorsOverview.tsx` | Adapted to serve as the Selectors tab content, scoped to the active case only (remove the cross-case table and case filter dropdown). |
| `appStore.ts` | New state shape (`appMode`, `activeCaseTab`, `settingsOpen`), updated actions, remove `activeView` and `sidebarCollapsed`. |

### Removed Components

| Component | Reason |
|-----------|--------|
| `Sidebar.tsx` | Eliminated — responsibilities redistributed to dashboard, case workspace tabs, and top bar. |

### Preserved As-Is

- `CaseAnalysis.tsx`, `EntityGraph.tsx`, `EntityTimeline.tsx`, `InsightsPanel.tsx` — Wrapped in the Analysis tab.
- `SelectorList.tsx` — Used within the modified `SelectorsOverview.tsx` / Selectors tab.
- `TagBadge.tsx`, `TagManager.tsx` — Used inline within captures and entities.
- `SearchBar.tsx`, `SessionControls.tsx`, `ConnectionStatus.tsx` — Stay in top bar.
- `Dashboard.tsx` — Preserved, may need minor updates to case card styling.
- All hooks (`useCases`, `useCaptures`, `useTags`, `useSearch`, `useSelectors`, `useServerStatus`) — unchanged.
- All IPC channels — unchanged.

## Migration Notes

All references to the old `activeView` state and its values (`'dashboard'`, `'case-overview'`, `'capture-viewer'`, `'case-analysis'`, `'selectors-overview'`, `'settings'`) must be updated across the codebase. Key locations to grep for `activeView`:

- `appStore.ts` — state definition and all actions
- `MainContent.tsx` — view switch logic
- `TopBar.tsx` — conditional rendering based on current view
- `Sidebar.tsx` — removed entirely, but callers of sidebar-triggered navigation must be updated
- Any component tests referencing `activeView` values

The `sidebarCollapsed` state and any references to it are also removed.

## Edge Cases

- **App startup:** Show dashboard. No automatic case selection.
- **Case deleted while viewing:** Return to dashboard via `goToDashboard()`.
- **Empty states:** Each tab shows contextual empty state (e.g., "No captures yet — start a recording session" on the Captures tab).
- **Recording indicator:** Pulsing red dot next to case name in the workspace header when session is active for the current case. Dot also shown next to the recording case in the case switcher dropdown.
- **Search:** Remains global in top bar. Current behavior preserved — can be enhanced to filter within active tab in a future iteration.
- **Keyboard navigation:** Tab switching via keyboard shortcuts can be added later.
- **New capture while on non-Captures tab:** Capture list updates silently in background. No forced tab switch. Optional: show a subtle badge/count on the Captures tab indicating new captures since last viewed.

## Testing Strategy

- **Unit tests:** Update `appStore` tests for new state shape (`appMode`, `activeCaseTab`, `settingsOpen`, updated actions including `navigateToCapture` and `toggleSettings`).
- **Component tests:** `CaseWorkspace` tab switching, `CaseSwitcher` dropdown open/close/selection, settings overlay toggle.
- **Integration tests:** `CaptureViewer` works correctly in master-detail context. Cross-tab navigation via `navigateToCapture`.
- **E2E tests:** Full navigation flow — dashboard → select case → navigate tabs → back to dashboard → switch case via dropdown. Settings overlay open/close from both modes.
