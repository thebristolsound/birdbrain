repo: thebristolsound/birdbrain
branch: main

## Last sync
date: 2026-09-03T20:02:00Z
tree: f70aea08c029

### Updated in this project
- Acted on upstream's standalone-mock corrections register (`docs/specs/2026-08-23-standalone-mock-corrections-brief.md`), which reviews this project's 2026-08-21 bundle: fixed 5 of the 16 open items where the mock was factually wrong, ground each in the shipped source
- Backlink map (brief item 4, a defect in map code written this session): added the zero-notes guard the `notes.length` divisor needed, grew the lattice with the case (`max(8, notes, ceil(entities/2))`) so notes 4+ no longer clamp onto row 7, spread notes down the centre lane past three while keeping the mock's rows 1/4/7 at three or fewer, and added no-notes / no-mentions empty states — matched to `overview/backlinkMapModel.ts`
- Signals copy (items 8, 10): exclusion footer now names Capture Preferences (there is no Settings → Privacy), reports a live entry count instead of the seeded 12, and states the ruled enforcement scope; section label is "Never capture in this case"; the detail rail's unbuildable `N matches · in M of K captures` became `Matches N of K captures` / `Applied to N of K captures` — matched to `signals/signalsModel.ts`
- Data screen (item 15): removed both `network.har` rows, the `verify.missing` ledger event targeting one, and the now-dead `.har` icon rule — Birdbrain captures no HAR and the spike (#804) is unanswered
- Fixed item 7 (`showBanner` enclosing Quick notes): the restructure had left both cards inside the conditional, so a case with nothing new rendered no Quick notes card at all. Quick notes moved to the top of the left column (unconditional, per the user's m0046 arrangement) with the Link map beneath it; the conditional now gates only the Since-your-last-visit card
- Overview metric tiles: the count-up left all five reading `0` beside a live delta whenever RAF was throttled (hidden or offscreen frame). Added a settle timeout so the tiles always land on their real values

### Deliberately not applied
- Item 12 (draw the capture-row multi-select checkbox): the checkbox-free row is a standing user decision from this session — selection moved to a footer action bar on ⌘/shift-click. Upstream keeps the checkbox for test coverage; this stays a live design-vs-engineering conflict, not an oversight
- Items 1, 2, 3, 5, 6, 9, 11, 13, 14, 16 need a design decision (copy and treatment) rather than a defect fix, and are left for a directed pass

## Sync history
### 2026-08-11T06:35:32Z
- Regenerated design_handoff_style_sync/ as v2 against the final 2/4/6 token system, diffed against the real globals.css + ui/{button,input,textarea,badge,card,index} (v1's 4/6/8/12/16 scale was rejected in engineering review as stale)
- Withdrew per-tab case binding from the prototype (design decision): browser sim popup back to upstream's one-global-active-case model
- Encoded engineering-review decisions: export manifest scope field shown in the export dialog; backlink map capped at 20 nodes with "showing N of M"
### 2026-08-11T00:32:15Z
- Confirmed upstream extension has NO options page (no options_ui in manifest.json) — the sim's options tab is a deliberate prototype addition, kept read-only and truthful
- Grounded it in manifest.json + utils/api.ts + background.ts: server URL corrected to http://127.0.0.1:19845, added the auto-provisioned access token row (birdbrainServerToken via /api/status), and made the screenshot setting a read-only mirror of the app's status.captureScreenshots (it is not extension-local)
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
- Produced `design_handoff_style_sync/` — the prototype's styling pass expressed as an apply-ready patch for `globals.css` and `components/ui/*`
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
| Overview backlink map | src/renderer/components/overview/{BacklinkMap.tsx,backlinkMapModel.ts} |
| Captures | src/renderer/components/captures/*.tsx |
| Wayback tab (in Captures viewer) | src/renderer/components/captures/WaybackTab.tsx |
| Case Reviewer (design direction) | src/renderer/components/dashboard/cases/DataExplorer.tsx, src/renderer/components/captures/ForensicsTab.tsx |
| Selectors | src/renderer/components/selectors/*.tsx |
| Notes | src/renderer/components/notes/*.tsx |
| Tags | src/renderer/components/tags/*.tsx |
| Data explorer | src/renderer/components/dashboard/cases/DataExplorer.tsx |
| Signals | src/renderer/components/signals/*.tsx, src/renderer/components/signals/signalsModel.ts |
| Settings | src/renderer/components/settings/*.tsx, src/renderer/components/settings/db/*.tsx |
| Extension setup guide | src/renderer/components/extension/{InstallExtensionGuide,InstallExtensionStepper,installSteps}.tsx |
| New case wizard | src/renderer/components/dashboard/cases/{NewCaseWizard,CreateCaseDialog,ImportCaseDialog}.tsx |
| Command palette | src/renderer/components/layout/CommandPalette.tsx |
| Browser sim: popup / context menus / toast / options tab | extension/manifest.json, extension/src/{background,content,toast}.ts, extension/src/popup/popup.tsx, extension/src/utils/api.ts |

## Note on syncing
A later sync attempt (2026-08-07) rebuilt the Captures screen from upstream `1.0.1-beta.17`
and was reverted at the user's request — upstream's current Captures treatment (gradient
placeholder thumbnails, accent pill badges) conflicts with this project's standardization
pass. **Settled 2026-08-11 (design decision, engineering review item 11): the prototype
side wins — viewer tabs are Screenshot / Page / Text / Wayback, Source removed, Wayback
promoted back from the details panel. Do not re-import upstream's Captures treatment.**

Upstream state observed at that time, for reference:
- version 1.0.1-beta.17, tree 541a8b8eae62
- Captures is a 3-pane list / viewer / details rail with tabs Screenshot / Page / Source / Text
- adds an annotation editor (`captures/annotation/`) and a trusted-timestamp provenance axis
- adds export dialogs, diagnostics, onboarding wizard, DB admin, and global search areas
