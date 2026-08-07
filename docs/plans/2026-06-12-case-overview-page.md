# Case Overview page — implementation plan

Source: Claude Design handoff bundle (`.design-bundle/birdbrain-design-system/`), file `Case Overview.html`,
Direction **A · Briefing**. Decisions confirmed by Matt 2026-06-12:

- Direction A (Briefing)
- "Since last visit" via localStorage (no DB migration)
- Overview becomes the case landing page (replaces redirect to /captures)
- Overview renders the design's own identity subhead; existing CaseHeader hidden on this route

## Design → data mapping

| Design block | Data source |
|---|---|
| Case subhead (title, type pill, description, code, Export) | `caseQueryOptions` ; type pill colors mirror `CASE_ICONS` in CaseCard.tsx |
| Since-last-visit banner (+N captures, +N sources, +N selectors, +N notes) | computed from `createdAt > lastVisitAt` (localStorage per case) |
| Metric tiles (Captures, Sources, Selectors, Tags, Notes) | captures list length, distinct hostnames, selectors length, `tagCountForCase`, `noteCount` |
| Capture activity (14-day bars) | bucket `capture.createdAt` by day |
| Top sources | group captures by `new URL(url).hostname`, top 6; deterministic tone palette |
| Selector coverage | `selectorsQueryOptions` + `selectorMatchCounts` + **new** distinct-capture counts per selector |
| Evidence integrity bar | `lastVerifiedStatus`: verified / unverified (never verified) / tampered (`tampered`,`chain-broken`,`missing`) |
| Recent captures strip | latest 6 captures + `useCaptureThumbnail`, NEW badge if `createdAt > lastVisitAt`, shield from `lastVerifiedStatus` |

Deviations from mock (flagged):
- "Resume capture" primary CTA does not exist in-app (capture lives in the extension) → primary CTA is
  "Review N new" → navigates to `/cases/$caseId/captures` (matches the banner CTA in the design).
- Mock's selector "kind" (Domain/Wallet/Telegram…) isn't in the data model → rows show label + pattern with
  regex/text icon instead.
- Mock's "+13 selector matches" digest tile → "+N selectors" (match rows carry no exposed timestamps).
- Tweaks panel knobs are design-time only → bake defaults: roomy density, rounded-2xl, timeline on, glow accent
  (shimmer on case name via existing `.shimmer-text`).
- Design is dark-only; implementation uses semantic Tailwind tokens so light mode works automatically.

## File changes

### Main process (per-selector distinct capture counts — needed for coverage block)
1. `src/main/services/database.ts` — add `getSelectorCaptureCounts(caseId)`:
   `SELECT selector_id, COUNT(DISTINCT capture_id) … FROM selector_matches JOIN selectors …`
2. `src/shared/ipc.ts` — add `SELECTORS_CAPTURE_COUNTS: 'selectors:captureCounts'`
3. `src/main/ipcHandlers.ts` — register handler
4. `src/preload/index.ts` — expose `selectors.captureCounts(caseId): Promise<Record<string, number>>`

### Renderer
5. `src/renderer/lib/queries.ts` — `selectorCaptureCountsQueryOptions` + query key
6. `src/renderer/hooks/useLastVisit.ts` — **new**: per-case `lastVisitAt` in localStorage
   (`birdbrain:lastVisit:<caseId>`). Returns the previous visit timestamp; stamps the current visit once per mount.
7. `src/renderer/components/overview/CaseOverview.tsx` — **new**: Direction A composition
8. `src/renderer/components/overview/` — **new** blocks (small files):
   `CaseSubhead.tsx`, `SinceLastVisitBanner.tsx`, `MetricRow.tsx`, `ActivityTimeline.tsx`,
   `SourcesBlock.tsx`, `SelectorCoverageBlock.tsx`, `VerifyBar.tsx`, `RecentCapturesStrip.tsx`
9. `src/renderer/routes/__root.tsx` — add `overviewRoute` (`/overview`), point `caseIndexRoute` redirect at it
10. `src/renderer/components/layout/Sidebar.tsx` — add `overview` to `SidebarSection`, `NAV_ITEMS`
    (first, `LayoutDashboard` icon), `SECTION_PATHS`
11. `src/renderer/components/dashboard/cases/CaseWorkspace.tsx` — hide `CaseHeader` on overview route;
    persist `lastActiveSection: 'overview'`
12. `src/shared/types.ts` — extend `lastActiveSection` union with `'overview'`

### Tests
13. `tests/` — unit test for `getSelectorCaptureCounts` alongside existing database tests

## Verification
- `npx tsc --noEmit` (renderer + node tsconfigs as wired in repo)
- `pnpm lint`
- `pnpm test`
- Manual: `pnpm dev`, open a case → lands on Overview; light + dark; empty case (0 captures) renders sanely

## Style rules
- Semantic tokens only (`bg-card`, `border-border`, `text-text-*`, `shadow` via `.neu-card` utilities)
- Lucide React, `strokeWidth={1.8}` sidebar convention
- No entrance animations on routine UI; reuse `fadeUp`/`stagger` presets only where Dashboard does
- No semicolons, single quotes, 2-space indent, 100ch
