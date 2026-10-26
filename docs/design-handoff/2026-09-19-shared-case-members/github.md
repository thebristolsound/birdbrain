repo: thebristolsound/birdbrain
branch: main

## Last sync
date: 2026-10-15T01:52:00Z
tree: 0c5ee8fc148d (main)
compared: b0a1a510...main (21 commits, 300 files)

### Updated in this project
- Light tokens: upstream `globals.css` merged the Light Contrast patch (text-muted #52525b, text-faint #66666f, accent #4f52e0 / hover #4346d1, input #8b8b93, new `--color-hue-{orange,sky,pink}-fg`). The bundled DS stylesheet predates it, so `Birdbrain.dc.html` now carries the light values as a helmet override; dark unchanged
- Top-bar search rebuilt to upstream `SearchBar.tsx` + `shared/searchFields.ts` (retrieval first slice, CI-5): every capture row shows the Exhibit Number chip and 12-char Content Hash; field hits grouped by field (Link target, Image alt text, From / Reply-To / X-Originating-IP header) with mono preview and ×N; Notes group; header hits open the Text tab, link hits the Links tab
- Not rebuilt: the remaining ~90 renderer files in the diff carry the React Compiler wiring (`scripts/react-compiler.ts`) and test-id changes with no visible delta (`TopBar`, `SinceLastVisitBanner`, `overviewModel`, `notesWorkspaceModel` read as the prototype already draws them)
- Upstream merged our `docs/design-handoff/2026-10-12-launched-browser/` bundle and returned `docs/specs/2026-10-12-launched-browser-and-investigation-feasibility-assessment.md`: S4, S5 and 15 states Accept; Modify on S1 (no version before launch), S2 (subtitle limit, no-VPN line, Egress pointer, operator-name tooltip), S3 (rail below ~1,020px, non-Case screens, no "on top" on Wayland, never show the shortcut as working), S6 (reason wording, where "Show them" opens), states 5/9/10/11 (reload advice, extension name, "Capture Session" unqualified), tokens (status fg tokens, type scale 10/11/12/14/18, radii 2/4/6), Exhibit Numbers (bare number / `NK-12`). **Revision pass on `Launched Browser.dc.html` not yet made** — a directed design turn
- Not acted on: `docs/plans/2026-10-12-review-on-request-label.md` (repo process)

## Sync history
### 2026-10-12T03:52:30Z (tree 6724907dc2f5)
- Light-theme contrast audit from upstream `globals.css` + renderer call sites: `Light Contrast.dc.html` (measured ratios, current vs proposed specimens) and `design_handoff_light_contrast/README.md` (light-only token patch + call-site sweep). No screen rebuilt

### 2026-10-12T03:34:23Z (tree 6724907dc2f5)
- Re-checked at 03:34Z: upstream tree unchanged. `Launched Browser.dc.html` 1f now draws the real top bar right cluster (`ConnectionStatus` dot-only below lg, Settings, theme) and the 48px `Sidebar` rail (Home + five sections, active left-edge bar); canvas defaults to dark mode (`dark` tweak); long copy moved into ⓘ tooltips
- Built `Launched Browser.dc.html` (pieces 1a–1z) from upstream `docs/specs/2026-10-11-launched-browser-and-investigation-ui-brief.md` (#1825): found browsers in Settings → Capture, start dialog (start / join / no operator name / launch wait), Capture Session panel as a 320px rail at 900 × 600 plus a pop-out, browser cues (Birdbrain side; browser-side profile name + theme colour marked for feasibility, P15), states 1–17, the Withheld from analysis mark in four placements (18–20), and the investigation header's "not read" count + gap entry (21–22). All 13 designer questions answered in the canvas header
- Added `design_handoff_launched_browser/` (README + `ENGINEERING_REVIEW.md` with a verdict row per surface and state), for upstream `docs/design-handoff/2026-10-12-launched-browser/`
- No screen-map renderer file changed in a way that needs a rebuild: `SessionControls.tsx`, `TopBar.tsx`, `CaseActionBar.tsx`, `SearchBar.tsx`, `SettingsView.tsx` read as the prototype already draws them. Not acted on: `2026-10-10-capture-engine-launched-browser-design.md`, `2026-10-11-*` spikes, `fork-authorship-design`, `live-store-encryption-design`, `persona-cookies-at-rest-assessment`, `2026-10-10-anonymous-team-sync-spike` (engine/main process; no renderer code)
- No commit sha recorded: diffed by reading the tree

### 2026-10-11T00:45:10Z (tree df531d36ce84)
- Captures viewer gained the **Links** tab between Text and Wayback, from upstream `LinksTab.tsx` + `linksTabModel.ts` (#1708): search text or address, External only, `N of M` count, host emphasis, kind / frame / rel / ×N chips, "Text names another host" and "In Case" marks, right-click link menu, plain-HTML empty state. Upstream's tab order (Screenshot / Page / Text / Links / Wayback, Source removed) now agrees with this project's settled viewer decision
- Not acted on (plans, no renderer code yet): `2026-10-09-case-retrieval-first-slice.md` (field search, exact check, unreviewed view as a Data tab — design input for the Investigate section later), `2026-10-09-recoverable-capture-delete.md` (main process only), `2026-10-06-label-to-merge.md` (repo process)
- No commit sha recorded: this sync diffed by reading the tree, not `github_compare`

### 2026-10-04T20:36:30Z (tree dfa6148e983a)
- Data → Manifest ledger rebuilt to upstream `ledgerModel.ts`: rows now carry the real entry types (`capture`, `exhibit`, `derivation`, `timestamp`, `deletion`, `export`) with `targetOf()` grammar, one `unreadable` line reported at its position, four-digit `formatSeq`, signer segment wording from `describeSigner`; added the `IntegrityStrip` (verified / integrity exceptions / unverified + Verify all)
- Settings gained the Personas tab (`PersonasSection.tsx`, ADR-0030): copy, rows with Import cookies / Delete and the one-sentence import summary, Add persona
- Still design-only upstream: no Members tab, sync pill, or Case settings route in `src/renderer` (members live in `src/main` only); `Shared Case.dc.html` and the Investigate section stay mocks
- Not acted on (specs, no renderer code): `2026-09-30-capture-engine-design.md`, `2026-10-02-case-retrieval-pipeline-design.md`, `2026-10-02-chain-head-anchoring-design.md`, `2026-09-20-third-party-verification-ergonomics-design.md`

### 2026-10-04T20:15:01Z (tree f2a3466cf082)
- Sync deferred at the user's request: upstream now implements Shared Case members (`caseMemberRepo.ts`, `ledgerModel.ts` `member-add` rows, `MEMBER_CODE_PATTERN` one to three `[A-Z0-9]`), but no screen was rebuilt this turn
- Built the Case investigation view from the pasted brief (`2026-10-03`, revised 10-04; engine spec #1714 still unsettled upstream): `Case Investigation.dc.html` turn 1 holds three Joint-map directions (1a graph, 1b lanes, 1c text-first); turn 2 holds the states the live screen does not reach (2a–2m: empty, no Joints, cannot-check/hash mismatch, canceled/stale/invalidated, withheld + same-name, contested, unreviewed on accepted, AI layer on + failed, AI settings + disclosure, review before sending, own identifiers, lookup consent, source-trail candidate)
- Added an interactive **Investigate** section to `Birdbrain.dc.html` (sixth sidebar item): run setup → run → Joint map + list/gaps → Joint detail → source inspector, with accept (context fields), reject/restore, add as support/conflict, dismiss/restore, return to unreviewed, Source Class, Withheld from analysis, copy marks, path picking; tweaks `aiLayer` and `narrowWindow`
- Designer calls: direction 1a + list; Investigate as its own sidebar section; tabs below 1150px; two claim-check axes as mono chip + italic reading; dotted (not dashed) proposed lines so the Joint map never reads as the Link Map
### 2026-09-19T19:41:00Z (tree be4eb5aff247; PR #1503 merged)
- Upstream merged our `2026-09-19-shared-case-members` bundle and answered items 19–25 in `docs/specs/2026-09-19-shared-case-members-feasibility-assessment.md`
- Applied all four Modifies and the label change to `Shared Case.dc.html`: Members ships alone (note in the settings nav); ledger defaults to one chain at a time with a member selector, Timeline as a secondary view whose Seq reads `Code·index`; exclusion drops to neutral (annotates, does not change verification); sync pill error state covers every `lastError.kind`; "Chain verified" → "Verified"
- Recorded the Accept constraints in copy: hue index = position in the Owner's `member-add` sequence, revoked members keep theirs; Member Code capped at three `[A-Z0-9]` characters
- Rebuilt `design_handoff_shared_case/` as the revised bundle
### 2026-09-19T18:22:15Z (tree 3aba2669dac0 · branch 252e04ab4021)
- Read the `t3code/privacy-first-collaboration` branch: it adds only two docs, `docs/specs/2026-09-19-collaborative-cases-design.md` (engineering contract, "design, not implemented") and `docs/specs/2026-09-19-shared-case-members-ui-brief.md`. No shared-Case code exists on either branch; `src/renderer/components/` has no Case-settings surface
- Built `Shared Case.dc.html`, a canvas mock of the brief's seven surfaces (1a–1h): Case settings → Members in all four tab states, Owner invite flow, peer join flow inside the New Case wizard, top-bar sync indicator states, attribution in captures/detail/tags/notes, revoke + exclude confirmations, and the four schema-4 Manifest entry kinds (`member-add`, `member-revoke`, `merge`, `exclude`) in the Data ledger grid
- Designer calls settled in the mock header: Member Code chip + fixed hue per member (accent = this installation); sync pill in the top-bar right cluster; copyable string primary with QR behind a disclosure; join as the wizard's third start card + ⌘K action
- Fingerprint format, invite prefix (`bbinvite1`), relay default, and entry field names come from the spec; copy follows `docs/agents/writing-guide.md` claim discipline (no unqualified secure/private; revoked members keep their copy, said at revoke time)
- Main `Birdbrain.dc.html` unchanged this sync: no screen-map source file changed in a way that affects it (upstream delta since 2026-09-03 is docs, agents, and website)

### 2026-09-03T20:02:00Z (tree f70aea08c029)
- Acted on upstream's standalone-mock corrections register (`docs/specs/2026-08-23-standalone-mock-corrections-brief.md`), which reviews this project's 2026-08-21 bundle: fixed 5 of the 16 open items where the mock was factually wrong, ground each in the shipped source
- Backlink map (brief item 4, a defect in map code written this session): added the zero-notes guard the `notes.length` divisor needed, grew the lattice with the case (`max(8, notes, ceil(entities/2))`) so notes 4+ no longer clamp onto row 7, spread notes down the centre lane past three while keeping the mock's rows 1/4/7 at three or fewer, and added no-notes / no-mentions empty states — matched to `overview/backlinkMapModel.ts`
- Signals copy (items 8, 10): exclusion footer now names Capture Preferences (there is no Settings → Privacy), reports a live entry count instead of the seeded 12, and states the ruled enforcement scope; section label is "Never capture in this case"; the detail rail's unbuildable `N matches · in M of K captures` became `Matches N of K captures` / `Applied to N of K captures` — matched to `signals/signalsModel.ts`
- Data screen (item 15): removed both `network.har` rows, the `verify.missing` ledger event targeting one, and the now-dead `.har` icon rule — Birdbrain captures no HAR and the spike (#804) is unanswered
- Fixed item 7 (`showBanner` enclosing Quick notes): the restructure had left both cards inside the conditional, so a case with nothing new rendered no Quick notes card at all. Quick notes moved to the top of the left column (unconditional, per the user's m0046 arrangement) with the Link map beneath it; the conditional now gates only the Since-your-last-visit card
- Overview metric tiles: the count-up left all five reading `0` beside a live delta whenever RAF was throttled (hidden or offscreen frame). Added a settle timeout so the tiles always land on their real values

### Deliberately not applied
- Item 12 (draw the capture-row multi-select checkbox): the checkbox-free row is a standing user decision from this session — selection moved to a footer action bar on ⌘/shift-click. Upstream keeps the checkbox for test coverage; this stays a live design-vs-engineering conflict, not an oversight
- Items 1, 2, 3, 5, 6, 9, 11, 13, 14, 16 need a design decision (copy and treatment) rather than a defect fix, and are left for a directed pass

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
| Case search (top bar dropdown) | src/renderer/components/search/SearchBar.tsx, src/shared/searchFields.ts, src/renderer/hooks/useSearch.ts, docs/plans/2026-10-09-case-retrieval-first-slice.md |
| Dashboard | src/renderer/components/dashboard/{Dashboard,HeroSection,RecentCases,CaseCard,QuickStartGuide,ExtensionBanner,DashboardFooter}.tsx |
| Case Overview | src/renderer/components/overview/*.tsx, src/renderer/components/overview/overviewModel.ts |
| Overview backlink map | src/renderer/components/overview/{BacklinkMap.tsx,backlinkMapModel.ts} |
| Captures | src/renderer/components/captures/*.tsx |
| Wayback tab (in Captures viewer) | src/renderer/components/captures/WaybackTab.tsx |
| Links tab (in Captures viewer) | src/renderer/components/captures/{LinksTab.tsx,linksTabModel.ts,CaptureViewer.tsx} |
| Case Reviewer (design direction) | src/renderer/components/dashboard/cases/DataExplorer.tsx, src/renderer/components/captures/ForensicsTab.tsx |
| Selectors | src/renderer/components/selectors/*.tsx |
| Notes | src/renderer/components/notes/*.tsx |
| Tags | src/renderer/components/tags/*.tsx |
| Data explorer | src/renderer/components/dashboard/cases/DataExplorer.tsx, src/renderer/components/data/{ManifestLedger.tsx,ledgerModel.ts,IntegrityStrip.tsx} |
| Signals | src/renderer/components/signals/*.tsx, src/renderer/components/signals/signalsModel.ts |
| Settings | src/renderer/components/settings/*.tsx (incl. PersonasSection.tsx), src/renderer/components/settings/db/*.tsx |
| Extension setup guide | src/renderer/components/extension/{InstallExtensionGuide,InstallExtensionStepper,installSteps}.tsx |
| New case wizard | src/renderer/components/dashboard/cases/{NewCaseWizard,CreateCaseDialog,ImportCaseDialog}.tsx |
| Command palette | src/renderer/components/layout/CommandPalette.tsx |
| Browser sim: popup / context menus / toast / options tab | extension/manifest.json, extension/src/{background,content,toast}.ts, extension/src/popup/popup.tsx, extension/src/utils/api.ts |
| Case investigation view (`Case Investigation.dc.html` canvas + Investigate section in `Birdbrain.dc.html`, design, unimplemented upstream) | pasted brief `docs/specs/2026-10-03-case-investigation-view-ui-brief.md` (draft), docs/specs/2026-10-02-case-retrieval-pipeline-design.md, docs/agents/writing-guide.md |
| Launched browser + withheld mark + not-read count (`Launched Browser.dc.html`, design, unimplemented upstream) | docs/specs/2026-10-11-launched-browser-and-investigation-ui-brief.md, docs/specs/2026-10-12-launched-browser-and-investigation-feasibility-assessment.md, docs/specs/2026-10-10-capture-engine-launched-browser-design.md, src/renderer/components/{status/SessionControls,layout/TopBar,layout/CaseActionBar,search/SearchBar,settings/SettingsView}.tsx |
| Light theme contrast audit (`Light Contrast.dc.html`, proposal) | src/renderer/styles/globals.css, src/renderer/components/ui/{input,textarea,section-label}.tsx, src/renderer/components/dashboard/caseTypeStyle.ts, src/renderer/components/overview/CaseSubhead.tsx |
| Shared Case members mock (`Shared Case.dc.html`, design, unimplemented upstream) | docs/specs/2026-09-19-shared-case-members-ui-brief.md, docs/specs/2026-09-19-collaborative-cases-design.md, docs/specs/2026-09-19-shared-case-members-feasibility-assessment.md, docs/agents/writing-guide.md |

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
