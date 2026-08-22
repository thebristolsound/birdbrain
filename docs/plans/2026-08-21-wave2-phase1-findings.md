# Redesign wave 2: phase 1 findings

Produced 2026-08-21 by the `ultracode` phase-1 pass over the seven wave-2 tickets, grounded
against `origin/main` at `a447ef03`. Companion documents:
`docs/plans/2026-08-21-redesign-wave2-ultracode-prep.md` (the prep this checks),
`docs/plans/2026-08-19-wave1-implementation-notes.md` (wave-1 adjudications that still bind).

Seven readers each took one ticket: its prep comments in comment order, its screen in the
2026-08-21 standalone mock, and every file:line its comments cite, re-derived against the
current tree. A synthesis pass then re-verified every claim on which two readers disagreed.
Per-ticket notes are held outside the repository at `/tmp/wave2/notes-<ticket>.md`; this
document carries only the cross-ticket findings, which are the ones the prep did not have.

**Four constraints below block their tickets and need a maintainer ruling before phase 2
starts on #400, #402 and #404.** They are B1 to B4 in section 4. Section 3's Group 1
(#395, #406, #397) carries no blockers and can start against the current tree.

Verified against the tree. Findings below; every fact I cite I checked myself.

---

# 1 File-level collision matrix

## 1.1 Delete-vs-modify (the dangerous class), #400 is the only deleter

| Path | Tickets | Kind | Status | Ruling for phase 2 |
|---|---|---|---|---|
| `src/renderer/components/selectors/SelectorTableRow.tsx` | #395 modify, #400 **delete** | delete-vs-modify | **Ruled, deliberate** (2026-08-22T03:30:55Z) | #395 ships the pill here as an interim carrier. #400 deletes the file and re-renders origin in `SignalDetailRail.tsx`. **#395 must put `ORIGIN_LABEL`/`ORIGIN_ICON` in a standalone module (for example `selectors/selectorOrigin.ts`), not module-level in the deleted component**, otherwise #400 either resurrects the maps by hand or drops the exact-label AC. #395's reader recommends this; make it mandatory. |
| `src/renderer/components/selectors/SelectorTable.tsx` | #395 modify (no-op, header count), #400 **delete** | delete-vs-modify | Benign | #395's entry is likely no change at all. Instruct #395 to make it literally no change so the delete is clean. |
| `src/renderer/components/selectors/BulkAddSelectorsModal.tsx` | #395 **modify** (`origin:'manual'` in the `parsed.unique.map`), #400 **delete** | delete-vs-modify | **Neither reader flagged this** | Real. #395 stamps a per-item origin here; #400 deletes the file and lifts its dedupe logic into `BulkImportDrawer.tsx`. **#400 must carry `origin:'manual'` into the drawer's per-item map or bulk-added selectors silently regress to NULL after #400 lands**, a silent hole in the exact provenance claim #395 exists to make. Add as an explicit #400 AC. |
| `tests/components/SelectorTable.test.tsx` | #395 **modify** (adds 2 origin cases), #400 **delete** | delete-vs-modify | #400's reader caught the delete; #395's reader did not know | #400 replaces it with `SignalRow.test.tsx`. **#400's replacement must carry forward #395's two assertions** (origin label renders; origin-absent renders nothing) or #395's AC3 loses its regression pin one merge later. |
| `tests/components/BulkAddSelectorsModal.test.tsx` | #395 **create**, #400 **must delete** | create-vs-delete | **Neither reader flagged this. Verified absent today (`ls tests/components/` -> only `CreateSelectorCard.test.tsx`, `SelectorTable.test.tsx`)** | #400 grounded before this file existed, so its deletion list omits it. #400 will hit a red suite from a file it never planned for. Add it to #400's deletion list now, and fold its assertion into the drawer test. |
| `src/renderer/components/extension/InstallExtensionGuide.tsx` | #404 **delete** |, | No collision | Verified sole importer is `__root.tsx:25`. `installSteps.tsx` / `InstallExtensionStepper.tsx` survive; #406 edits neither. |
| `src/renderer/components/layout/OnboardingWizard.tsx` | #404 **delete** |, | No collision | Verified `onboardingOverlayOpen` consumers are exactly `__root.tsx:86/:147` and `CapturesGettingStarted.tsx:39/:128`, the latter is in #397's `captures/` surface. See section 1.3. |
| `src/renderer/components/overview/SelectorCoverageBlock.tsx` | #402 **delete** |, | No collision | Verified sole importer `CaseOverview.tsx:23/:156`, no test file. |

**Net: the delete-vs-modify risk is concentrated entirely in the #395/#400 pair, and two of its five instances are unflagged.**

## 1.2 Same-file, same-region rewrite (needs serialisation)

| Path | Tickets | Kind | Ruling |
|---|---|---|---|
| `src/main/services/db/core.ts:6` | #395 (28->29), #400 (->30) | same-line rewrite | Verified `LATEST_SCHEMA_VERSION = 28` at line 6. **Strict serial, #395 first.** As the prep says. |
| `src/main/services/db/migrations.ts` | #395 (v29 block), #400 (v30 block) | same-file append at tail | Verified 594 lines, last block `if (version < 28)` at :557. Both append after it. **Strict serial.** #400 must re-read the tail rather than hardcode 30 before #395 lands. |
| `src/renderer/routes/__root.tsx` | #400 (delete `/selectors`+`/tags` routes and imports, add `signals`), #404 (delete `/extension-setup` route + first-run branch, mount tour) | same-file rewrite, **same route-tree region** | Verified imports at :21/:23 (#400) and :25 (#404); route definitions at :293-316 (#400) and :235-246 (#404); tree entries :328 (#404) / :334/:336 (#400). Adjacent, not overlapping. #404 merges last -> #404 rebases. Trivial. |
| `src/renderer/components/overview/CaseOverview.tsx` | #400 (retarget `goToSelectors`), #402 (full recomposition, deletes the coverage card) | rewrite-over-touch | Verified `goToSelectors` -> `/cases/$caseId/selectors` at :103, `SelectorCoverageBlock` at :156. **#400 must make the retarget or TanStack typecheck fails**; #402 then rewrites the whole return block. Order #400->#402 handles it. #402 must be told the line moved. |
| `src/renderer/components/layout/Sidebar.tsx` | #400 (rewrite `NAV_ITEMS`/`SECTION_PATHS`), #404 (add `data-tour={nav-${id}}`) | rewrite-then-annotate | #404 last, rebases onto #400's final list. #404 must not reintroduce `nav-selectors`/`nav-tags`. |
| `src/renderer/components/captures/CaptureViewer.tsx` | #397 (delete `'source'`, add `'wayback'`, possible tab-strip rebuild), #404 (`data-tour="viewertabs"` on the `tablist`) | rewrite-then-annotate | Verified `ViewTab` :19, `TABS` :21, `role="tablist"` :147, `'source'` branch :255. #404 places the anchor on whatever #397 leaves. |
| `src/renderer/components/captures/CaptureDetailsPanel.tsx` | #397 (delete Wayback `<section>` :428-459 + 5 dead symbols), #390 (`caseId` into `useNoteEditor` :156, `defaultPrevented` guard on Escape :521) | same-file, disjoint regions | Verified: 565 lines, `useNoteEditor` :156, `WaybackTab` :456, Escape at :522. #397->#390 order means #390 re-locates its two edits. Cheap. |
| `src/renderer/components/notes/NoteEditor.tsx` / `useNoteEditor.ts` | #390 (rebuild), #404 (`data-tour="noteeditor"`) | rewrite-then-annotate | #404 last. |
| `src/renderer/components/dashboard/cases/CaseWorkspace.tsx` | #400 (`isSignals` + add to the `overflow-hidden` branch), #397 (three-column captures may edit the same branch) | same-file, same branch | Small. #400 first, #397 rebases. |

## 1.3 Same-file append (tolerable in parallel, second rebases)

| Path | Tickets | Note |
|---|---|---|
| `src/shared/types.ts` | #395, #400, #402, #404 | 4-way, all appends in distinct regions. |
| `src/shared/ipc.ts` | #395, #400, #402 | 3-way, distinct domain blocks. |
| `src/shared/schemas.ts` | #400 (`CaptureServerStatus`, `lastActiveSection`), #404 (2 settings keys) | 2-way. **Evidence include-list, line 188.** Both trip the backstop. |
| `src/preload/index.ts` | #400 (cases), #402 (notes) | 2-way, distinct blocks. |
| `src/main/ipcHandlers.ts` | #400, #402 | 2-way. |
| **`src/shared/birdbrainApi.ts`** | #402 lists it; **#400 does not** | Verified this is the hand-maintained `window.birdbrain` type surface (`cases:` block at :82-92). **#400 adds four channels and never lists this file, that is a certain `pnpm typecheck` break.** #402's reader caught the pattern for its one channel; #400's reader missed it entirely. Add to #400's file list. |
| `src/main/services/db/selectorRepo.ts` | #395 (origin, four functions), #400 (`getSelectorCaptureMatrix`) | Scattered vs append. Serial order resolves. |
| `src/main/services/captureServer.ts` | #395 (`POST /api/selectors` :459-464), #400 (block reorder :296->post-:319, `/api/status` :198-209) | Textually disjoint handlers, same file. Serial order already forced by the migration. |
| `src/renderer/lib/api/keys.ts` | #400 (3 keys), #402 (1 key) | Append. #390 adds none, see section 6. |
| `src/renderer/lib/api/selectors.ts` | #395 (optional), #400 | Append. |
| `CLAUDE.md` + `AGENTS.md` | #400 (route block :88-100 + component map), #406 (tree line :64 + extension section :149-158), #404 (route block :91 + :103 + component map) | **3-way**, and #400/#404 collide in the *same* route-tree block. Both files are separate regular files, not symlinks. Order #400->#406->#404 means each rebases forward. |

## 1.4 Test-fixture collisions the readers mostly missed

| Path | Tickets | Note |
|---|---|---|
| **`tests/renderer/lib/queries.test.ts`** | #395, #400, #402 | Verified it holds a hand-maintained per-domain bridge stub (`cases:` :54, `tags:` :75, `selectors:` :87, `notes:` :96). **All three tickets add channels; only #402's reader flagged this file.** Every added channel needs a stub entry or the suite reds. |
| `tests/main/services/database.test.ts` | #395 (v29), #400 (v30) | Both append a `table_info` case and a bump-history comment line. Serial. |
| `tests/main/services/caseArchiveRoundTrip.test.ts` | #395 (seed origin), #400 (seed exclusions + mode) | Both mutate the same seed block. Serial. |
| `tests/main/services/captureServer.test.ts` | #395 (origin assertions ~:1079-1108), #400 (reorder pins, `/api/status` :482-495) | Disjoint regions. |
| `tests/components/CreateSelectorCard.test.tsx` | #395 (mandatory `origin:'manual'` in the exhaustive assertion), #400 ("must keep passing") | Fine as sequenced. |

## 1.5 e2e ownership, the prep map is materially incomplete

Verified which specs reference the routes #400 deletes: `bulk-selectors`, `density`, `readme-screenshots`, `tags`, `case-archive`.

| Spec | Prep says | Reality |
|---|---|---|
| `e2e/readme-screenshots.spec.ts` | #404 | **3-way.** Verified `screenshot-onboarding` :298 and `/extension-setup` :610 (#404), `/selectors` :559 + `screenshot-selectors` :562 and `/tags` :573 + `screenshot-tags` :576 (#400), plus #397's captures hero shot changes. #400 *must* edit `4b`/`4d`, the routes cease to exist. Ownership must be split by section, not by file. |
| `e2e/density.spec.ts` | unassigned | **2-way.** #395 needs the `Selector-table row density` describe (:91-160) green (hence "pill in the expanded panel only"); #400 deletes that describe outright. Verified :87 carries the `#421` regression comment. Order works, but **#400 must file the follow-up for the lost `--d-row` pin before finishing**, the prep never budgeted it. |
| `e2e/bulk-selectors.spec.ts`, `e2e/tags.spec.ts`, `e2e/case-archive.spec.ts` | unassigned | #400 owns all three (routes and testids die). Add to the ledger. |
| `e2e/empty-captures-state.spec.ts` | unassigned | #404 claims it. Verified `CapturesGettingStarted.tsx:39` holds `setOnboardingOverlayOpen` and `:128` the call, and `tests/components/CapturesGettingStarted.test.tsx:16/:38/:40` assert the store. But the file sits in #397's `captures/` surface. Assign to #404 explicitly and tell #397. |
| `e2e/capture-multiselect.spec.ts` | must stay green untouched | Holds. Constrains #397 to `capView: 'detailed'` default with the checkbox retained. |

---

# 2 Verdict on the merge order

**The declared order holds. #395 -> #400 -> #397 -> #406 -> #390 -> #402 -> #404 is correct and I would not reorder it.** Four of its six edges are hard dependencies, verified:

- **#395 -> #400**, hard. v29/v30 on the same two files; #400 deletes the file #395 edits.
- **#400 -> #402**, hard. `CaseOverview.tsx:103` navigates to `/cases/$caseId/selectors`, which #400 deletes; #402 recomposes the file. Also #402 cannot name the Signals route until #400 does.
- **#400 -> #404**, **#397 -> #404**, **#390 -> #404**, **#402 -> #404**, hard. Six of nine `data-tour` anchor families live on surfaces those four rebuild.
- **#397 -> #390**, soft but real. #390 makes two edits inside `CaptureDetailsPanel.tsx`, which #397 rewrites.
- **#390 -> #402**, the weakest edge. Grounded on a `src/renderer/lib/api/notes.ts` conflict that does not exist (see section 6). Keep the order; the dependency is nil.

**What must change is the prep's *annotations*, not its sequence:**

1. **The declared serial pair is under-specified.** "#395 (v29) then #400 (v30), both touching `migrations.ts` and `core.ts`" understates it. The pair also shares `selectorRepo.ts`, `captureServer.ts`, three test files, and, the real risk, **five delete-vs-modify collisions including two nobody flagged**. Restate the pair as "#395 and #400 share a serialised file *set*, not two files."
2. **#406 should be declared order-free.** Verified fully disjoint from every other ticket except the `CLAUDE.md`/`AGENTS.md` doc lines. Holding it at slot 4 means a slip in #397 blocks a ticket that depends on nothing. Move it to slot 1 or mark it "merge whenever the slot is free."
3. **e2e ownership must be re-issued by spec section**, not by file (section 1.5).
4. **`src/shared/birdbrainApi.ts` must be added to #400's file list** or its typecheck fails.

---

# 3 Concurrency groups for phase 2

Implementation can be wider than the merge order, because most edges are rebase-cost rather than build-blockers. Ordered groups (each group starts when the previous group's *merges* land):

**Group 1, start now, fully concurrent (3 worktrees off `main`)**
- **#395**, no dependency on anything in the wave.
- **#406**, verified disjoint from all six others; only doc-line contact.
- **#397**, no wave dependency for its own work. Rebase cost: one `CaseWorkspace.tsx` branch line against #400, and it must not edit `readme-screenshots.spec.ts`.

**Group 2, starts when #395 merges (1 worktree)**
- **#400**, cannot start the migration before #395's v29 is on the tip. Everything else about it (the Signals screen, ~2500 lines) *could* be built in parallel in Group 1 if the migration commit is deferred, but I would not: the delete-vs-modify set makes a stale base expensive.

**Group 3, starts when #400 and #397 merge (2 worktrees, concurrent with each other)**
- **#390**, needs #397's `CaptureDetailsPanel` shape and #400's Signals route for chip navigation. Isolate the `targetType -> route` mapping in one function so that second dependency is a one-liner.
- **#402**, needs #400's Signals route name only. Independent of #390.

**Group 4, starts when all six merge (1 worktree)**
- **#404**, genuinely last. Cannot place six of nine anchors earlier.

Wall-clock is bounded by the chain #395 -> #400 -> {#390, #402} -> #404. #406 and #397 are free riders on that chain.

**Two tickets must not run concurrently under any arrangement: #395 and #400.** The delete-vs-modify set is not merge-resolvable by git, resolving `SelectorTableRow.tsx` (deleted on one side, edited on the other) requires a human to decide the origin pill's fate, and the two unflagged instances would resolve silently and wrongly.

---

# 4 Constraints that are infeasible as designed

**Blocking, need a ruling before the owning ticket starts**

| # | Ticket | Constraint |
|---|---|---|
| B1 | #400 | **The auto-capture switch cannot be built as ruled.** The acceptance criterion reads "Sets `autoCaptureMode` to `per-case` for the active Case and reads its state back." But `autoCaptureMode` is a *global*, three-valued setting (`schemas.ts:530`, default `'notify'`) with no per-case dimension. Unstated: what OFF writes; what the switch reads when the mode is `'auto'`; whether "for the active Case" implies a new per-case boolean. Reading A (global on/off between `per-case` and `notify`) means flipping it in one case flips it in all, under a card headed "Case-level." That is a misrepresentation risk on a capture tool. |
| B2 | #402 | **The consolidated Overview drops the Evidence-integrity/VerifyBar card, not just the coverage card.** Verified: `ovClassic` (template 9863-9911) contains both; `ovConsolidated` (9859-9862) is empty; "Evidence integrity" occurs once in 16161 lines, inside the classic branch. Only the coverage card was ruled on. Removing the app's only case-level verified/tampered display flips #402 to `evidence-affecting`, human review, no auto-merge, a second evidence review the wave did not budget. |
| B3 | #404 | **"Skip ends the tour for the session" vs "per-chapter completion persisted" are contradictory.** Needs a decision: does an auto-fired chapter that is skipped write its completion key? |
| B4 | #400 | Storage design not ruled: two JSON columns on `cases` vs a `case_exclusions` table. The columns choice makes `importCaseRow` the only archive change; the table choice adds five edit sites. Pick before the migration is written. |

**Design gaps, the mock does not specify a state the AC requires**

| # | Ticket | Constraint |
|---|---|---|
| G1 | #402 | **No map empty state exists.** With zero notes the mock's `noteAngle` divides by zero and produces NaN coordinates. The ruling explicitly requires an empty state for both no-notes and no-Mentions. |
| G2 | #402 | **Note lattice placement breaks past three notes.** `row = clamp(1 + noteIndex*3, 0, 7)` piles notes 4..N on row 7, and the note branch returns before the collision search runs. Real cases exceed three notes routinely. |
| G3 | #390 | **No broken-Mention chip treatment.** `mentionColor`/`mentionStyleFor` have no broken branch; the AC requires one. |
| G4 | #406 | **No disconnected / loading / no-token state for the options page**, the exact case the page exists to explain. |
| G5 | #400 | **`--d-row` has no successor on Signals.** The mock's rows are two-line with fixed `8px 10px` padding. The `#421` regression pin retires with no replacement metric. |
| G6 | #404 | **The `browser` anchor host does not exist.** The mock's Browser button opens a *simulated* Chrome screen; the app has no such button and no `/browser` route. |
| G7 | #404 | **Demo-case affordances do not exist.** Both the intro copy ("We seeded a demo case for you") and the final step's "Delete demo case" button assume seeded data no wave-2 ticket adds. |

**Copy / content defects to send back rather than silently fix**

| # | Ticket | Constraint |
|---|---|---|
| C1 | #400 | Footer copy names "Settings -> Privacy," which does not exist (the global list is under Capture Preferences). "12 entries" is mock seed data. |
| C2 | #400 | Stack-mode footer copy ("never captured, even by selectors.") contradicts the ruled all-sources-including-manual enforcement. |
| C3 | #395 | The design does not cover #395's actual surface, the classic Selectors table shows origin nowhere and its flask button opens no panel. "Pixel-match the mock" is not literally checkable for this ticket. |
| C4 | #397 | The mock's rows carry **no** multi-select checkbox; the app must keep one because `capture-multiselect.spec.ts` must stay green untouched. |
| C5 | #397 | The Wayback tab hosts the existing `WaybackTab`, not the mock's side-by-side compare (#401). It will not pixel-match by design. |
| C6 | #406 | The mock specifies `var(--font-mono)`; the extension bundles only Inter Variable. Either a system mono stack (no token) or a second webfont in the shipped zip. Do not pick unilaterally. |
| C7 | #400 | The bulk-import drawer loses the live new/dup/blank counts that `bulk-selectors.spec.ts:31-33` pins by test id, a capability reduction against the "no capability is lost" AC. |
| C8 | #397 | The list-header search slot stays empty (#695). Decide: `flex-1` spacer, or collapse the header to one row until #695 lands. |
| C9 | #397 | The Page tab's "Archived copy" provenance banner (template 10365-10373) has no app equivalent and no owning ticket. File it. |
| C10 | #390 | The mock's `Create "<q>" as note/selector` popup row is unspecified by any AC and overlaps #391. Exclude and say so. |
| C11 | #400 | Per-signal "Export CSV" has no backing query (`getSelectorMatchesForExport` is case-wide). Either widen it or the button lies about its scope. |
| C12 | #402 | The `showBanner` conditional encloses Quick Notes as well as the Since card, almost certainly a flattened fragment, but confirm it. |

**Mock bugs not to reproduce** (readers found four; all four are correct)
- #402: divide-by-zero at zero notes.
- #390: `mentionCandidates` pre-slices the primary kind to 8 *before* filtering.
- #404: `tourEnd`/`tourSkip` set the case-chapter flag from *any* chapter, an ext replay would suppress a case chapter that never ran.
- #404: `syncTour` leaves a null rect on a missing anchor, rendering a 296px tooltip at viewport (0,0). **Reachable in this app**, this is the anchor-slip insurance and must be built first, not last.

---

# 5 Cross-ticket risks no single reader could see

**R1. Six of seven PRs trip the evidence path backstop; the wave budgeted one review.**
Verified against `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`: `package.json` :197, `pnpm-lock.yaml` :198, `src/shared/schemas.ts` :188, `src/main/services/captureServer.ts` :79, `extension/src/utils/api.ts` :72, `src/shared/noteDoc.ts` :135, `overviewModel.ts` :173, `VerifyBar.tsx` :172. Which fires where: #395 (`db/**`, `captureServer.ts`), #397 (lockfile), #400 (labelled), #402 (`overviewModel.ts`, `VerifyBar.tsx`), #404 (schemas), #406 (four entries). Only **#390** escapes if it truly stays off `noteDoc.ts`, and it still trips on the lockfile. **Every one of the six needs a pre-written Evidence impact section, or the reviewer treats a green badge as a cleared gate.** The prep's "one evidence review (#400)" is a per-*label* count, not a per-*backstop-hit* count. And B2 could make it two labels.

**R2. Lockfile contention is real and both deps are absent from the tree.**
Verified: `node_modules/react-resizable-panels` NOT INSTALLED, `node_modules/@tiptap/suggestion` NOT INSTALLED, `@floating-ui/dom@1.7.6` already resolved transitively. #397 and #390 both regenerate `pnpm-lock.yaml`. Order puts #397 first -> #390 rebases and re-runs `pnpm install` (never hand-edits). #395, #400, #402, #404, #406 add nothing and stay out of the race.

**R3, #397's entire API surface for its new dependency is unverified against this tree.**
Its reader read `react-resizable-panels@4.12.3`'s exports (`Group`/`Panel`/`Separator`/`useDefaultLayout`, with `PanelGroup`/`PanelResizeHandle`/`autoSaveId` removed) from the registry, not from `node_modules`, the package is not installed. Every pre-v4 example and most model priors show the removed API. **Phase 2's first step for #397 must be `pnpm add` then reading the installed `.d.ts`.** This is the single most likely source of a whole day lost to a wrong-API rewrite, and no other reader could have seen it.

**R4, jsdom has no `ResizeObserver` and the jsdom vitest project declares no `setupFiles`.**
The moment #397's `CapturesRoute.test.tsx` renders the panel Group, all ten of its existing tests fail with a ReferenceError. This is a *pre-existing* suite going red from a change that looks unrelated to it. Only #397's reader saw it; it belongs in the wave-level checklist because it is the pattern (`matchMediaStub.ts` precedent) any future component test hitting a browser-only API will need.

**R5, coverage-gate exposure is concentrated, and `coverage:diff` is not what `pnpm test` runs.**
`pnpm coverage:diff` fails below 90% of *changed* lines and scores the **working tree** against the merge base, so both it and `pnpm test:coverage` must be re-run after every edit (#508). Exposure ranking: **#400** (largest diff, ~2500 lines of presentational Signals `.tsx`), **#402** (new hand-written SVG geometry), **#397** (presentational rows exercised mostly by e2e), **#404** (large tour `.tsx`). All four readers independently reached the same mitigation, hoist the branchy logic into a pure module (`backlinkMapModel.ts`, `captureColumns.ts`, `mentionModel.ts`, `tourSteps.ts`). Make that a wave-level rule, not four coincidences. **#406 alone is exempt**: `vitest.config.ts:25` includes only `src/**` and `:35` excludes `extension/**`, so an extension-only diff reports `NOT SCORED` and exits 0, its PR body must say so explicitly and name its two test files as the substitute.

**R6, the shared test-bridge stub is a three-way collision nobody sequenced.**
Verified `tests/renderer/lib/queries.test.ts` holds a hand-maintained per-domain stub (:54 cases, :75 tags, :87 selectors, :96 notes). #395, #400 and #402 all add channels. Only #402's reader noticed. Each addition needs a stub entry; the second and third to land will red the suite on a file they never planned to touch.

**R7, `#400` will fail typecheck on a file it never listed.**
`src/shared/birdbrainApi.ts` is the hand-maintained `window.birdbrain` type surface (verified `cases:` block at :82-92). #400 adds four channels; #402 correctly lists this file for its one channel; #400 does not list it at all.

**R8, twelve queued `ready-for-agent` fixes sit on surfaces this wave rewrites.**
#683/#686/#687 edit `CaptureList.tsx`'s error branch and the captures route's three dialog components, exactly #397's diff. The maintainer already ruled these held for post-wave dispatch. Restate it: **no wave-2 worktree pulls a queued fix into its diff**, however tempting the adjacency.

**R9, `src/renderer/stores/appStore.ts` gains an unplanned two-ticket claim.**
#397 *may* lift `activeViewerTab` into it (needed so the route can hide two columns on the Wayback tab); #404 *removes* `onboardingOverlayOpen`/`setOnboardingOverlayOpen`. Both are small, but the prep's map lists neither. Verified the store fields at :31/:38/:72/:79.

**R10, e2e-only verification means four of the wave's biggest visual changes have no CI gate.**
Verified: repo-wide grep for `toHaveScreenshot` returns nothing and no `-snapshots` directory exists. `readme-screenshots` and `theme-screenshots` only *write* PNGs. So Signals, the three-column Captures, the consolidated Overview and the tour cannot fail CI on visual drift, pixel conformance rests entirely on the reviewer pre-pass. Say so in the wave doc so nobody mistakes a green run for a design sign-off.

---

# 6 Where two readers disagreed

**6.1, `src/renderer/lib/api/notes.ts` / `keys.ts`: is #390 a co-editor?**
- **#402's reader**: no. All five sources #390 needs already exist as query options; #390 adds nothing to the query layer.
- **#390's reader**: agrees, and grounds it in #390's own 2026-08-22T02:38:38Z ruling ("filter the cached list queries client-side rather than adding one").
- **The prep plan**: "#390 and #402 both extend `src/renderer/lib/api/notes.ts` and the query keys."
- **I believe the readers, against the prep.** Verified `invalidateNoteQueries` at :29-33 invalidates exactly three keys, and #390's design needs no fourth. **The prep's declared #390/#402 conflict does not exist; #402 is the sole owner of that file this wave.** Both readers also independently spotted the real hazard there: `queryKeys.notes(caseId)` is `['notes', caseId]`, which does *not* prefix-match `['notes','referenceEdges',caseId]`, so #402 must add its own invalidation line inside that same three-line function.

**6.2. Prep comment: "the main-process side of the map is done and waiting."**
- **The prep comment (#402)**: `backlinkCountsForCase(caseId)` is ready.
- **#402's reader**: incomplete, it aggregates `note_id` away and can never yield edge endpoints.
- **I believe the reader. Verified in the tree**: `noteReferenceRepo.ts:142-153` is `SELECT r.target_type, r.target_id, COUNT(DISTINCT r.note_id), COUNT(*) ... GROUP BY r.target_type, r.target_id`. No `note_id` in the projection or the grouping. **The map cannot be drawn from what is merged.** #402 must add `referenceEdgesForCase` plus a channel, which sits close to the "do not add a new channel for v1" ruling. That ruling's own sentence is scoped to *labels*, so the addition is necessary rather than contrary, but it must be called out in the PR, not slipped in.

**6.3. Origin-pill placement: interim carrier or design answer?**
- **#395's prep comment (02:37:59Z)**: the expanded row-detail panel is "accepted as within AC3."
- **#395's 03:21:46Z correction**: "I had read the current app rather than the design." The design puts it in the Signals rail.
- **#395's reader and #400's reader agree**: the panel is the surface for #395 *as an interim carrier*; #400 carries it into `SignalDetailRail.tsx`.
- **No contradiction between readers; both correctly take the later ruling.** Worth restating because it is the *reason* the delete-vs-modify churn is deliberate, and the reason the label/icon maps must survive the deletion.

**6.4. Prep comment: "five creation paths" for selector origin.**
- **The prep comment**: five.
- **#395's reader**: six, it omits `NewCaseWizard.tsx`.
- **I believe the reader. Verified**: `NewCaseWizard.tsx:4` imports `createSelector` from `@renderer/lib/api/selectors` and `:74` calls it inside the preset loop. **Missing it means every wizard-created preset selector carries NULL and renders indistinguishably from a legacy row, a silent hole in the exact provenance claim the ticket exists to make.**

**6.5. Prep comment: #404's four cross-cutting files, "nothing else in the wave edits those files."**
- **#404's reader**: undercounts, anchor placement also requires `Sidebar.tsx` (#400), `TopBar.tsx`, `ExportMenu.tsx`, `HeroSection.tsx`, `CaptureViewer.tsx` (#397), `NoteEditor.tsx` (#390), plus #400's and #402's new components. And `CLAUDE.md`/`AGENTS.md` route maps are edited by #400 too.
- **#400's reader**: independently flags the same four-file overlap with #404 from the other side.
- **I believe both readers; they corroborate.** The prep's claim is false. Because #404 merges last it is rebase cost, not breakage, but the implementer must be told to expect churn rather than a clean tree.

**6.6, `e2e/readme-screenshots.spec.ts` ownership.**
- **The prep**: #404 owns it.
- **#400's reader**: "#400 must edit it anyway, the routes are gone."
- **#397's reader**: "will want to re-run and eyeball it but must not EDIT it."
- **I believe #400's reader. Verified**: `/selectors` at :559 and `/tags` at :573 are literal navigations to routes #400 deletes. #400 has no choice. **Ownership must be split by section**: #400 owns `4b`/`4d`, #404 owns `0a`/`4h`, #397 owns re-running and flagging.

**6.7. Line-number drift between readers.**
Several readers report one-off drift from the prep's citations (`useNoteEditor` at :37 not :36; `capture-detail-panel.spec.ts` running to :102 not :101; `isUrlBlacklisted` at :88-90 not :89-91; `app-lifecycle.spec.ts` second test closing at :23 not :22; the `readme-screenshots` comment lines). **I spot-checked four and the readers were right each time**; the prep's anchors are one-line-off in the places the readers say they are. No decision turns on it, but phase-2 implementers should re-derive anchors rather than trusting either document.

**6.8. One thing every reader got right that is worth repeating.**
All seven independently reached the same conclusion about the mock's own token syntax, its context-menu bindings, and its `data-tour` attributes: the `@[kind|label]` form is prototype shorthand and not the shipped model; `sc-camel-on-context-menu` is #701 and wave 2 leaves no hooks; `data-tour` belongs to #404 alone. **No ticket should add a context-menu handler or a `data-tour` attribute except #404.** That convergence is the strongest signal in the seven notes and should be a wave-level checklist line.
