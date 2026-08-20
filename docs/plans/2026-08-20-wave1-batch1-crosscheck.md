# Wave 1 batch 1: independent validation and PR cross-check

Prepared 2026-08-20. Two workflow passes run from a session that wrote none of the batch-1 code, so the findings are independent of the implementers. Companion to `docs/plans/2026-08-19-wave1-implementation-notes.md` and the batch status comment on spec #382.

## What was run

The first pass took all nine wave-1 tickets and re-derived every code claim in the planning notes from the tree, following the rule in `docs/agents/triage-labels.md` that amending an issue to the `ready-for-agent` bar is re-validation rather than transcription. It checked 241 claims and corrected 67 of them. Nine agents, no errors.

The second pass audited the six batch-1 pull requests against that baseline. For each it asked whether the diff acted on a fact the first pass had corrected, what happened to the blockers, whether the evidence gate held on the two gated pull requests, and whether the bodies report real `coverage:diff` output. Six auditors and a ranking pass, no errors.

Neither pass wrote to the tracker.

## Ready-for-agent bar, all nine tickets

| Ticket | Bar | Claims checked | Corrected | Blocking questions | PR |
| --- | --- | --- | --- | --- | --- |
| #387 | fail | 26 | 6 | 1 | #673 |
| #389 | pass | 26 | 8 | 0 | #664 |
| #395 | fail | 31 | 8 | 3 | - |
| #396 | pass | 36 | 14 | 0 | #666 |
| #397 | fail | 22 | 7 | 3 | - |
| #400 | fail | 31 | 5 | 3 | - |
| #403 | fail | 22 | 9 | 2 | #677 |
| #563 | pass | 22 | 3 | 0 | #668 |
| #622 | pass | 25 | 7 | 0 | #674 |

Four tickets met the bar. Five did not, and two of those five, #387 and #403, were implemented anyway because batch 1 had already started when the validation ran.

## Cross-check verdicts

| PR | Issue | Verdict |
| --- | --- | --- |
| 664 | #389 | `needs_changes` |
| 666 | #396 | `minor_issues` |
| 668 | #563 | `minor_issues` |
| 673 | #387 | `minor_issues` |
| 674 | #622 | `needs_changes` |
| 677 | #403 | `minor_issues` |

## Verdict per pull request

| PR | Issue | Verdict | One-line reason |
| --- | --- | --- | --- |
| #674 | 622 | `needs_changes` | Three false or unbounded claims on the evidence path: a stale archive claim in the Evidence impact section, a verifier reason that asserts a cause verification never tested, and a "none found" line that prints over zero scanned cases. |
| #664 | 389 | `needs_changes` | The v28 migration is create-only, which is the stale notes-doc prescription and contradicts spike constraint 7 as posted on the issue, while the PR body still claims constraint 7 is done. |
| #677 | 403 | `minor_issues` | Both blocking questions were answered from the planning doc rather than a maintainer ruling: unscoped note-selection plumbing was built, and the AC's gating rule was reinterpreted without being declared as a deviation. |
| #673 | 387 | `minor_issues` | Implements the posted ruling exactly and closed the remaining bar failures itself, but the match-summary line is normally absent, Capture now vanishes rather than degrades, and the pixel check is unreproducible. |
| #666 | 396 | `minor_issues` | Dodged every stale fact that mattered; a non-existent `html.bb-nomo` kill switch is claimed in the body, the multi-select row tint drifted off the prototype values, and the Escape ordering rationale is inverted. |
| #668 | 563 | `minor_issues` | Comment-only diff that landed the intended outcome and re-read the bundle from the durable branch; only documentation-grade issues remain. |

## Blocking defects

None. No finding in any of the six audits was rated at blocking severity. Two findings are rated major on #674 and one on #664, and those are what drive both `needs_changes` verdicts, but neither PR contains a defect that makes an already-merged evidence package unverifiable or corrupts stored evidence. The #674 findings are wrong assertions in operator-facing and reviewer-facing text over correct code; the #664 finding is a deviation from a stated spike constraint plus a PR body that claims the constraint is satisfied.

## Stale facts that reached the diffs

The notes doc mostly held up. Across six PRs and roughly forty corrections, four stale facts were acted on, and only two of them changed behaviour or shipped text.

**#664 (major, changed the artifact).** Stale claim: the v28 backfill is provably empty, so a create-only migration is defensible (`docs/plans/2026-08-19-wave1-implementation-notes.md:236` and `:246`). What the tree says: the Database Admin hatch wrote `notes.body_doc` without parsing it, so a hand-written mention-shaped node can exist and would go unindexed. What the diff did: the new v28 block runs `CREATE TABLE note_references` plus an index and then sets `user_version = 28`, with no backfill and no `rebuildForCase` call, while the PR body's constraint list asserts item 7 ("migration populates it from `body_doc` in the same block") is done. The PR did update the justification after review to name the hatch, but the outcome is still the stale prescription. Compounding it, `rebuildForCase` -- the repair seam that justification leans on -- has no production caller anywhere in the diff; it is reachable only from tests, and the missing repair surface is filed as #662.

**#674 (major, shipped in the Evidence impact section).** Stale claim: imported chains cannot false-positive because deleted captures are never imported. What the tree says: I re-checked it directly. `src/main/services/caseArchive.ts` calls `captureRepo.collectCapturesForCase(caseId)`, which is `SELECT * FROM captures WHERE case_id = ?` -- every live row, including the unreconciled one -- and `add('manifest.jsonl', readManifestSnapshot(caseDir).jsonl)` ships the manifest verbatim, deletion entry included. So the unreconciled state does travel through a `.birdbrain` archive; the protection is the caller-side case scoping, not the absence of the row. What the diff did: the code is correct, but Evidence impact section 6 carries the stale sentence into the one artifact a reviewer of an evidence-affecting PR is meant to rely on.

**#666 (minor, body only).** The PR body claims the entrance animation is "gated by `useReduceMotion` so the `prefers-reduced-motion` and `html.bb-nomo` kill switches apply." `html.bb-nomo` is a prototype-only class with zero hits under `src/`. The shipped code is correct.

**#666 (minor, shipped styling).** The multi-selected row treatment departs from `Birdbrain.dc.html:4674-4675`, which gives a multi-only row no border and an accent-12% background; the PR ships `border-accent/20` and `bg-accent-subtle` (0.16 alpha), moved there deliberately in commit 464ff874 on the strength of a 4x screenshot read.

**#673 and #677 (minor, prose only).** #673 repeats the notes doc's "the prototype's always-Stop" framing; `Birdbrain.dc.html:7111` actually reads `capturing ? 'Stop capture' : 'Stop session'`. #677's pixel-truth claim against `screenshots/01-dashboard.png` is unreproducible because the screenshot script was discarded. Neither affects shipped behaviour.

**#668 (minor, refinement only).** The PR body cites the committed V1 ruling as lines 99-107 when the sentence is at 105-106; the cited range contains the sentence, and the baseline itself classed this as a refinement rather than an error. Notably, #668 did not propagate the notes doc's `/tmp/bb-handoff-2026-08/...` bundle paths -- it re-read the bundle from `origin/prototype/design-handoff-2026-08` and cites the branch in the shipped comment. That was the one correction that bore on the artifact, and it was taken.

## Blockers pushed through

**#677 pushed through two, and this is the sharper finding of the two tickets.** Issue #403 has exactly one maintainer comment, on open question 12 only. Neither remaining blocker was ruled on.

The note-row click target: the AC says the row opens Notes with the note selected, the app has no note-selection affordance, and the baseline judged that building one was unscoped. The PR built it -- `selectedNoteId` and `setSelectedNoteId` in `appStore.ts`, a `selected` prop on `NoteCard` rendering `aria-current`, wiring in `NotesOverview.tsx`, and an e2e test pinning it. The authority cited is `docs/plans/2026-08-19-wave1-implementation-notes.md:83`, a planning doc, and the same doc still lists the question as open at line 678 while line 641 defers to a "maintainer ruling below" that was never posted. This was a stop-and-give-up condition under the implementer contract. It was disclosed and tested, which is the mitigating half, but the ticket never scoped it.

The Quick Start versus feed gating: the AC says the feed appears once activity exists; the PR ships `cases.length === 0 ? <QuickStartGuide /> : <RecentActivityFeed />` and pins the divergent state in e2e ("a case with no captures or notes yet: the feed's empty state, not Quick Start"). That reinterprets an AC bullet, and unlike the note-row question it is not listed in the PR body's declared deviations. The reviewer is told the rule, not that the rule replaced the one the ticket asked for.

The remaining #677 bar failures (no starting files, incomplete command list, no evidence call) were scoped out honestly: the issue amendment was never posted, and the PR supplied all three itself, including the full coverage loop and a self-applied `evidence-affecting` label.

**#673 did not push anything through.** The blocker that decided how much of the ticket exists -- the page-status data source -- was settled by a maintainer ruling posted on the issue dated 2026-08-20, and the PR implements it literally: four data-backed states, no server capture-lookup endpoint, `#392` named as the wave-2 upgrade path, and `src/main/services/captureServer.ts` absent from the diff. The unobservable AC 4 was surfaced rather than hidden, with a table of three deliberate copy departures and two additions, all of which assert less than the prototype rather than more. The missing verification path and missing starting-files list were closed by the PR running the full loop anyway and by the merged notes doc respectively. #673 also overrode the notes doc's "not evidence-affecting" call in the conservative direction, applying the label to the PR and writing a full Evidence impact section, after checking all three touched paths against the acquisition list.

## Evidence gate

Both gated PRs carry `evidence-affecting` on the PR itself, verified against the PR rather than inherited from the issue, so the labelling gap that the implementer cannot fix on its own did not occur here. Both Evidence impact sections cover every line of their respective checklists in the notes doc. What remains is not missing sections but wrong content and a broken CI signal.

**#664.** The gate is satisfied as written: all seven checklist lines are covered, the archive bump rationale is present, and the round-trip known-answer test exists. The defect is upstream of the gate -- the constraint-7 deviation means the PR body's claim that item 7 is done is false, and that claim sits inside the evidence narrative. The implementer can fix this by either backfilling in the v28 block or restating item 7 as a declared deviation with the hatch rationale. The maintainer's job is the human evidence review that ADR-0005 requires, and to rule on whether a create-only v28 is acceptable given that the repair seam it names has no production caller.

**#674.** The gate passes structurally and one item is unusually strong: the ADR-0004 wording claim ("chain valid, row present, on-disk file state unknown") is in the shipped panel copy and asserted by a component test, not only in the PR body. Three things need fixing, all implementer-side: rewrite Evidence impact section 6, since `caseArchive.ts` disproves it; drop the causal clause "an interrupted delete" from the verifier reason in `src/shared/verify/evidencePackage.ts`, keeping only the fact the chain establishes, because an index tamperer who re-adds a legitimately deleted capture gets a benign explanation for free and the second known-answer test does not cover that case; and gate the "Every capture the manifests record as deleted is gone from the database" line so it cannot render when `casesScanned` is 0 or when `unscanned` is non-empty, with the test asserting its absence the way the `available: false` test already does.

One item is maintainer-side on both: `gh pr checks 674` reports `agent/pre-pass  pass  Not an agent PR -- pre-pass not applicable` while the PR carries `agent-pr` and `agent-authored`, so the ADR-0005 reviewer pre-pass shows green on an evidence-affecting agent PR without having evaluated the diff. The same gate misfires on #677 for a different reason (the workflow keys on `agent-pr`, which #677 does not carry). Re-run the pre-pass on #674 before merging rather than trusting the badge, and file the workflow gap.

## Merge order

The planned order does not hold. Move both `needs_changes` PRs to the back:

**#668 -> #673 -> #666 -> #677 -> #664 -> #674.**

The relative order of the four that can proceed is unchanged, so nothing rebases unnecessarily. #666 stays ahead of #677 because both touch `appStore.ts` and `tests/renderer/stores/appStore.test.ts`. #677 stays ahead of #674 because both add channels to `src/shared/ipc.ts`, `src/preload/index.ts` and `src/main/ipcHandlers.ts`.

Moving #664 from second to fifth is safe and I checked the reason it was placed early. #664 is the only PR that touches `migrations.ts` or `core.ts`, and none of #673, #666, #677 or #674 adds a migration, so there is no renumbering churn to avoid by landing it first. #664 also rewrites the schema-version assertion in `tests/main/services/database.test.ts` to read `LATEST_SCHEMA_VERSION` rather than a literal, which removes the one file-level coupling that argued for an early slot. Landing it last costs one rebase of a migration block that nothing else contends for.

#677 can merge ahead of #664 and #674 only after the maintainer rules on the two questions the implementer answered for itself. That is a ruling, not a rework, so it should not hold the queue for long.

## What to fix before human review

1. **#674** -- rewrite Evidence impact section 6. The correct statement is that the unreconciled state does travel through an archive, and that the caller-side `row.caseId === scannedCaseId` filter is what prevents a false finding in the destination.
2. **#674** -- drop "(an interrupted delete)" from the enriched reason in `src/shared/verify/evidencePackage.ts` and keep only "the chain records it as deleted," then add a known-answer test for an index that re-adds a capture the chain did delete.
3. **#674** -- guard the "Every capture the manifests record as deleted is gone from the database" sentence in `DiagnosticsPanel.tsx` on `casesScanned > 0 && unscanned.length === 0`, and assert its absence in the existing unscanned test.
4. **#664** -- either call the rebuild helper from the v28 block so the index is populated in the same migration, or obtain an explicit waiver on spike constraint 7 and stop listing item 7 as done in the PR body.
5. **#664** -- restore a real known-answer pin on the schema version. The replacement assertion at `tests/main/services/database.test.ts:920` now duplicates the one at `:434-438`, and the ledger comment reads "bumped in #389" with no version number, so the ledger stops recording versions at 27.
6. **#677** -- get a maintainer ruling on the note-row target and on the Quick Start gating rule, and add the gating change to the PR body's declared deviations regardless of which way the ruling goes.
7. **#674 and #677** -- re-run or fix `agent/pre-pass` so the ADR-0005 obligation is visible in the merge box, and file the workflow label-keying gap.
8. **#666** -- remove the `html.bb-nomo` claim from the PR body, and either restore the prototype's multi-select row values (no border, accent-12%) or record the departure as deliberate with the screenshot rationale.
9. **#673** -- state in the PR body that the match-summary line is normally absent outside a running session, since AC 4 asks for it and the current explanation attributes the gap only to MV3 eviction.

## Blocking questions still open on batch 2 and batch 3

These three tickets are not implemented yet. Each question below changes the schema, the acceptance criteria, or how much of the ticket exists, and each was re-derived from the tree on 2026-08-20 with file and line citations.

### #395

- Ruling A, the column shape: nullable TEXT with NULL = legacy (pill hidden on pre-existing rows, prototype-faithful, matches screenshot 14) versus TEXT NOT NULL DEFAULT 'manual' (every pre-existing row permanently displays "Added by hand," including rows that actually came from the extension). This decides the migration DDL in `src/main/services/db/migrations.ts`, whether the `Selector.origin` field at `src/shared/types.ts:579` is optional, the `?? null` fallback in `importSelectorRows` (`src/main/services/db/selectorRepo.ts:310-326`), and the assertions in `tests/main/services/database.test.ts` and `tests/components/SelectorTable.test.tsx`. It is the issue's own AC1 verbatim, so the ticket cannot be judged closed without it.
- Ruling B, the origin value for a selector created from DataExplorer's `CreateSelectorPopover` (`src/renderer/components/dashboard/cases/DataExplorer.tsx:156` -> `src/renderer/components/selectors/CreateSelectorPopover.tsx:41`): 'capture', because the value came from capture-derived extracted data, or 'manual'. One of the five creation paths has no defined expected value until this is ruled, so AC2 is unverifiable for it.
- Confirm the placement in AC5 is acceptable given that the expanded row-detail panel in `src/renderer/components/selectors/SelectorTableRow.tsx:179-221` opens only from the flask-icon button at lines 154-162 whose title is "Test matches." If the reviewer expects the origin visible without entering a match-testing affordance, the ticket needs a different surface and a wider diff, and that should be decided before the branch starts rather than in review.

### #397

- Row time treatment: the issue says clock icon plus short relative time, but pixel truth for the default detailed rows (Birdbrain.dc.html:1092, `capView` defaults to 'detailed' at :3945) is the long form with no clock; clock plus fmtAgoShort is the compact list variant only (:1115-1118). Which ships, and is the detailed/list `capView` toggle (:4745-4751) in scope at all?
- Wayback tab ownership against #401: does #397 ship a Wayback tab trigger rendering the existing WaybackTab content and remove the details-panel Wayback section (CaptureDetailsPanel.tsx:431-456), or does the tab arrive wholesale with #401 leaving three tabs here? The same ruling must cover hiding the list column and the details panel while Wayback is active (Birdbrain.dc.html:4779, :4861).
- Per-list capture search: the prototype's list header carries a recessed "Search captures..." input (Birdbrain.dc.html:936) that the app lacks entirely. Is it inside "the three-column layout as designed," or a separate ticket?

### #400

- Enforcement scope: does the per-case exclusion list block source=manual captures into that case, as the global list does today (src/main/services/captureServer.ts:296 runs before the source branch at :309, pinned at tests/main/services/captureServer.test.ts:541-556), or only auto and selector? The AC and the prototype's stack-mode footer copy (Birdbrain.dc.html:4550, 'even by selectors') disagree. This decides the server test matrix, and since source: 'auto' (extension/src/background.ts:575) and source: 'selector' (:705) are both inside commented-out blocks, an auto-and-selector-only ruling ships a feature with no live producer until #600.
- Card container: the prototype card at Birdbrain.dc.html:1806-1844 includes a role=switch per-case auto-capture on/off toggle bound to `autoCapture` state (:4525-4527) that has no backing setting anywhere in the tree (the global `autoCapture`Mode control was removed under #570 and survives only in main-process settings and the /api/status payload). Does #400 ship it disabled and inert, or mount the exclusion section without it? AC 3 ('Signals UI matches the prototype') cannot be evaluated until this is ruled.
- Manifest visibility: should exclusion-list or mode changes, or per-URL blocked-capture events, become manifest entries? Today a block emits only an ephemeral renderer CaptureEvent (captureServer.ts:298-304, emitCaptureEvent at :93-97). A yes adds a seventh variant to ManifestEntrySchema (src/shared/schemas.ts:437-444) and ripples into src/shared/verify/manifestChain.ts, the verifier CLI, and VERIFY.md. This changes both the schema surface and the size of the ticket.

## Reproducing this

Both passes were Workflow runs inside a Claude Code session. The raw structured findings went to `/tmp` and are not durable, so this document is the record. To rebuild the baseline, run one agent per ticket with the triage-labels re-validation rule and that ticket's section of the planning notes as the hypothesis to test, then one auditor per pull request holding its ticket's baseline.
