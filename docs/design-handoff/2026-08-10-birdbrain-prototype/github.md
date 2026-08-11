repo: thebristolsound/birdbrain
branch: main

## Last sync
date: 2026-08-11T00:32:15Z
tree: 37dbf57cd7a0

### Updated in this project
- Confirmed upstream extension has NO options page (no options_ui in manifest.json) — the sim's options tab is a deliberate prototype addition, kept read-only and truthful
- Grounded it in manifest.json + utils/api.ts + background.ts: server URL corrected to http://127.0.0.1:19845, added the auto-provisioned access token row (birdbrainServerToken via /api/status), and made the screenshot setting a read-only mirror of the app's status.captureScreenshots (it is not extension-local)

## Sync history
### 2026-08-10T22:50:10Z
- Read extension/src/content.ts + toast.ts; recreated the real in-page overlay 1:1 in the browser sim: dark #131316 capture toast with #6467f2 spinner (replacing the invented HUD/frame) and amber .birdbrain-selector-highlight mark styling (rgba(251,191,36,.35) + 2px #f59e0b bottom border) replacing per-type colors
- Confirmed upstream has no area-select overlay tools — closed that open item
### 2026-08-10T22:15:19Z
- Re-read extension/src/background.ts to ground per-tab case memory: upstream binds ONE global active case (popup follows the app); the browser sim's two-tab per-tab binding demo is a deliberate prototype improvement, not a recreation
- Earlier today: rebuilt right-click context menus 1:1 from background.ts (Birdbrain ▸ capture items, selection-context Create Selector) and slimmed the popup toward upstream's minimal structure
### 2026-08-10T19:05:00Z
- Rebuilt the right-click menus 1:1 (Birdbrain ▸ Capture Full Page / Capture Full Page (Scrolling) in page context; top-level Create Selector from Selection in selection context; disabled when disconnected or no active case)
- Slimmed the popup mock toward the real popup's minimal structure (status dot, quiet match summary, no colored chips)

### 2026-08-09T01:45:00Z
- Promoted Wayback to a full viewer tab on captures (timeline with calendar/range filter, pagination, pinning, side-by-side snapshot reference) — grounded in upstream WaybackTab.tsx copy and behavior
- Moved chain of custody out of the inspector into the Export case file dialog (custody summary always included in export); kept the quiet "Chain verified" chip in the capture header
- Pinned snapshots now surface in the export dialog as archive.org references
- Audited Dashboard and Captures against upstream — match confirmed; user declined pulling ProvenanceBadge / ForensicsTab / AnalysisTab (Captures stays as-is per the standing revert note)

### 2026-08-07T16:26:30Z
- Produced `style_sync_patch/` — the prototype's styling pass expressed as an apply-ready patch for `globals.css` and `components/ui/*`
- Measured the delta against upstream primitives: radius scale (4/6/8/12/16, `--radius-2xl` 12px→16px), control sizes standardized to 32/28px, `Button` `sm` text 14px→12px, status-surface tokens, recessed inputs, new `SectionLabel` + `CardPanel`
- No repo writes: patch is delivered as documentation for a developer to apply

### 2026-08-03T17:05:00Z
- Rebuilt the full desktop app UI 1:1 as an interactive prototype (Birdbrain.dc.html)
- Covers dashboard, case workspace (overview/captures/selectors/notes/tags/data), settings, extension guide, new-case wizard, command palette
- Copied logo + extension icon assets from the repo

## Screen map

| Screen | Repo files |
|---|---|
| App shell / TopBar / Sidebar | src/renderer/routes/__root.tsx, src/renderer/components/layout/TopBar.tsx, src/renderer/components/layout/Sidebar.tsx, src/renderer/styles/globals.css |
| Dashboard | src/renderer/components/dashboard/{Dashboard,HeroSection,RecentCases,CaseCard,QuickStartGuide,ExtensionBanner,DashboardFooter}.tsx |
| Case Overview | src/renderer/components/overview/*.tsx, src/renderer/components/overview/overviewModel.ts |
| Captures | src/renderer/components/captures/*.tsx |
| Wayback tab (in Captures viewer) | src/renderer/components/captures/WaybackTab.tsx |
| Case Reviewer (design direction) | src/renderer/components/dashboard/cases/DataExplorer.tsx, src/renderer/components/captures/ForensicsTab.tsx |
| Selectors | src/renderer/components/selectors/*.tsx |
| Notes | src/renderer/components/notes/*.tsx |
| Tags | src/renderer/components/tags/*.tsx |
| Data explorer | src/renderer/components/dashboard/cases/DataExplorer.tsx |
| Settings | src/renderer/components/settings/*.tsx, src/renderer/components/settings/db/*.tsx |
| Extension setup guide | src/renderer/components/extension/{InstallExtensionGuide,InstallExtensionStepper,installSteps}.tsx |
| New case wizard | src/renderer/components/dashboard/cases/{NewCaseWizard,CreateCaseDialog,ImportCaseDialog}.tsx |
| Command palette | src/renderer/components/layout/CommandPalette.tsx |
| Browser sim: popup / context menus / toast / options tab | extension/manifest.json, extension/src/{background,content,toast}.ts, extension/src/popup/popup.tsx, extension/src/utils/api.ts |

## Note on syncing
A later sync attempt (2026-08-07) rebuilt the Captures screen from upstream `1.0.1-beta.17`
and was reverted at the user's request — upstream's current Captures treatment (gradient
placeholder thumbnails, accent pill badges) conflicts with this project's standardization
pass. Before syncing Captures again, confirm which side wins.

Upstream state observed at that time, for reference:
- version 1.0.1-beta.17, tree 541a8b8eae62
- Captures is a 3-pane list / viewer / details rail with tabs Screenshot / Page / Source / Text
- adds an annotation editor (`captures/annotation/`) and a trusted-timestamp provenance axis
- adds export dialogs, diagnostics, onboarding wizard, DB admin, and global search areas
