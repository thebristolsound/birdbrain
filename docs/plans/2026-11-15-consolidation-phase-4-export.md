# Consolidation phase 4: export through one dialog

**Status:** active

This is the detail plan for phase 4 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). Export
labels do not name their outputs today (finding U3), seven nouns name what two controls produce
(C1), and two icons stand for the same dialog (C2). This phase puts the ruled nouns on every
label, then gives export one entry and one dialog. Code references are to `origin/main` at
`ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan, the review notes left on #2201, #2205,
which moved the export menu into the top bar, and #2208, which added a known-answer test for
export bytes.

Slice 4.1 is copy and can start at once. Slices 4.2 to 4.4 waited for frame G and question 7
of `docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md`. Decision 7 of the parent
plan ruled on both on 2026-11-17, so they can start too.

The rules every slice follows are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces". Three files here are `blocking` in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`: `ExportDialog.tsx`,
`CaptureDownloadMenu.tsx` and `ImportCaseDialog.tsx`.

## The labels today

| Control | Where | Says | Produces |
| --- | --- | --- | --- |
| Menu item | `ExportMenu.tsx` | Export evidence report | Opens `ExportDialog` |
| Menu item | `ExportMenu.tsx` | Export case file | A Case Archive, through `exportArchive` |
| Dialog title | `ExportDialog.tsx` | Export case | |
| Preset `full` | `EXPORT_PRESETS` | Full evidence bundle | An Evidence Package |
| Preset `working` | `EXPORT_PRESETS` | Working copy | A Working Copy |
| Preset `court` | `EXPORT_PRESETS` | A label naming a venue | An Evidence Package without Notes |
| Confirmation | `ExportDialog.tsx` | Export written, with "Evidence package" or "Working copy" | |
| Confirmation | `ExportMenu.tsx` | Archive saved | |
| Icon button | `CaptureSelectionBar.tsx` | Export selection (title) | Opens `ExportDialog`, scoped |
| Menu | `CaptureDownloadMenu.tsx` | MHTML archive, PDF report, Screenshot (PNG) | One stored file |
| Button | `SignalsOverview.tsx` | Export all | CSV of every Persisted Match |
| Button | `SignalDetailRail.tsx` | Export CSV | CSV for one Selector |
| Context menu, Selector | `entityMenu.ts`, `selectorMenuEntries` | Export matches to CSV | The same CSV |
| Context menu, Tag | `entityMenu.ts`, `tag-export` | Export… then "ZIP + manifest" | Opens `ExportDialog` for the Tag's Captures |
| Context menu, Tag | `entityMenu.ts`, `tag-copy-markdown` | Copy as markdown | Clipboard text |
| Button | `HeroSection.tsx` | Import Case… | Opens `ImportCaseDialog` |

The critique's count of nine export controls missed the three context-menu rows, which
`src/renderer/components/contextmenu/entityMenu.ts` builds.

## What proves a package is unchanged

The parent plan corrected one claim this plan also made: `e2e/export.spec.ts` compares the
names of a package's entries, not their bytes, so it cannot show that a package is unchanged.
Two tests can:

- `tests/main/services/exportKnownAnswer.test.ts` (#2208) pins the hash of every member, the
  package hash and the verifier's answer for nine exports. It guards the main side. Each of its
  cases passes `annotations: 'none'`; the presets in `EXPORT_PRESETS` pass `'burned'`, so no
  case pins a preset's selection exactly.
- `tests/components/ExportDialog.test.tsx` holds the preset tests, which show what
  `ExportSelection` the dialog submits.

A slice that changes labels only shows that both pass unedited and that nothing under
`src/main/` changed. Slice 4.2 needs more, set out below.

`CONTEXT.md` rules the nouns: **Evidence Package** (avoid "export", "bundle", "ZIP"), **Working
Copy**, and **Case Archive** (avoid "case file"). The writing guide's claim discipline keeps
venue words out of the docs, and `features.mdx` still describes the third preset with one.

## Slice 4.1: the ruled nouns, the file type, one icon

Findings U3, C1 and C2. No behaviour changes.

- **Change.**

  | Today | Becomes |
  | --- | --- |
  | Export evidence report | Export Evidence Package… |
  | Export case file | Export Case Archive… |
  | Full evidence bundle | Evidence Package (.zip) |
  | Working copy | Working Copy (.zip) |
  | The third preset's label | Evidence Package without Operator notes (.zip) |
  | "Evidence package" and "Working copy" in the confirmation | Evidence Package, Working Copy |
  | Archive saved | Case Archive saved |
  | Export all | Export all matches (CSV) |
  | ZIP + manifest | Evidence Package… |
  | Import Case… | Import Case Archive… |

  Preset descriptions lose "bundle" and "package" used as loose synonyms. The export icon in
  `ExportMenu.tsx` also goes on `CaptureSelectionBar.tsx`, the two Signals buttons and the two
  export rows in `entityMenu.ts`. The
  viewer's Download menu keeps the download icon and its items: it hands over a stored file as
  it is.
- **Must not change.** Any string `src/main/services/export.ts` or `reportHtml.ts` writes into a
  package, the preset ids, and `ExportSelection`. `tests/main/services/export.test.ts` names
  the third preset in a test title and a comment only; those may follow the new wording, and
  the test itself, which shows the two evidence presets' entry names differ by exactly
  `notes.md`, is not touched.
- **Files.** `ExportMenu.tsx`, `ExportDialog.tsx`, `CaptureSelectionBar.tsx`,
  `SignalsOverview.tsx`, `SignalDetailRail.tsx`, `HeroSection.tsx`, `entityMenu.ts`.
- **Tests.** `tests/components/ExportMenu.test.tsx`, `ExportDialog.test.tsx`,
  `CaseSubhead.test.tsx` (which holds ExportMenu cases, #841), `entityMenu.test.tsx`,
  `AppToaster.test.tsx` and `tests/renderer/lib/notify.test.ts` where they quote a
  confirmation. End to end:
  `export.spec.ts`, `case-archive.spec.ts`, `topbar-layout.spec.ts`, `wayback-panel.spec.ts`
  and `round1-session.spec.ts` find controls by these labels.
- **Screenshots.** The export menu, the dialog's choice list, the selection bar and the Signals
  header, before and after.
- **Docs.** `features.mdx`: the lines on exporting an Evidence Package "as a full bundle or"
  the venue wording, and on the Working Copy. `tester-guide.mdx` where it names a menu item.
- **Evidence tier.** `blocking` through `ExportDialog.tsx`. `CaptureDownloadMenu.tsx` is also
  `blocking`; this slice keeps its items and its icon, so it edits that file only if a label
  there has to change. The Evidence impact section says labels only: the preset tests pass with
  only their label assertions edited, nothing under `src/main/` changes, and
  `exportKnownAnswer.test.ts` passes unedited.
- **Acceptance.**
  - [ ] Every label that names an export's output uses the `CONTEXT.md` term.
  - [ ] No UI label or docs line uses a venue word for the third preset.
  - [ ] Each preset submits the same `ExportSelection` as before the change.

## Slice 4.2: one "Export" entry and one dialog

Finding U3. No longer waits: decision 7 of the parent plan ruled on the bundle.

- **Change.**
  - `ExportMenu.tsx` becomes a button that opens `ExportDialog`. The Case Archive's progress
    and error handling move from the menu into the dialog.
  - The dialog's title follows its scope: the whole Case, or the selection's count.
  - One choice list replaces the presets:
    - **Evidence Package (.zip)**, with a checkbox "Leave out Operator notes".
    - **Working Copy (.zip)**.
    - **Case Archive (.birdbrain)**, which runs the existing `exportArchive` mutation. It is
      offered for the whole Case only; under a selection it is disabled with the reason.
  - With Case Archive chosen, "Customise contents", the purpose field and the Trusted Time
    notice do not show: none applies to an archive.
  - `EXPORT_PRESETS` loses the third preset. `detectPreset` treats an evidence selection with
    Notes off as Evidence Package with the checkbox ticked.
- **Kept as they are.** ADR-0010's line between an Evidence Package and a Working Copy, and
  ADR-0009's rule that a selection ships the full Manifest, with its note in the scope row.
- **Known-answer test.** `tests/main/services/export.test.ts` already shows that an Evidence
  Package without Notes holds the same entry names as one with them, less `notes.md`. It
  compares the names and not the bytes of the other members, so the checkbox rests on the
  second addition below for those. Two additions:
  - A unit test over the choice list pins three equalities against the selections on `main`:
    Evidence Package with Notes equals today's `full` selection; with the checkbox ticked it
    equals today's third preset's selection; Working Copy equals today's `working` selection.
  - `exportKnownAnswer.test.ts` gains a case for each of those three selections as the dialog
    submits them, with `annotations: 'burned'`, since none of its nine cases uses one. The
    cases are added and pinned before the dialog changes, so the same answers hold after it.
  `e2e/export.spec.ts` still exports each choice and reads the names of the entries each one
  writes, as a check that the path works, not as proof of unchanged bytes. It does not run
  Package Verification.
- **Files.** `ExportMenu.tsx`, `ExportDialog.tsx`, and their two test files. Moving the
  ExportMenu cases out of `CaseSubhead.test.tsx` here closes #841.
- **Screenshots.** The dialog on each choice, for a whole Case and for a selection, before and
  after.
- **Docs.** `features.mdx` and `tester-guide.mdx`.
- **Evidence tier.** `blocking`. The Evidence impact section answers all four fields; an
  Evidence Package exported by an earlier version must still verify, which holds because the
  main-side export is untouched.
- **Acceptance.**
  - [ ] The Case has one export entry point in the chrome.
  - [ ] Each choice shows its file type before the Operator presses Export.
  - [ ] The three equalities hold.
  - [ ] A Case Archive exported from the dialog imports as a new Case, as
    `case-archive.spec.ts` checks today within one profile.

## Slice 4.3: Import beside Export

- **Change.** After 4.1 the dashboard button reads "Import Case Archive…". When slice 5.3 of
  the parent plan adds the Case menu, it carries the same item, which opens the import flow the
  dashboard already uses. This slice adds nothing else; it exists so the noun changes in one
  place and the menu item is not forgotten.
- **Order.** The parent plan puts 4.3 before 5.3, and a review comment on #2201 noted that the
  menu 4.3 adds to does not exist until 5.3. This plan resolves it by splitting the work: the
  relabel lands with 4.1, and the menu item lands inside 5.3.
- **Files.** None beyond 4.1 until 5.3 lands.
- **Evidence tier.** `ImportCaseDialog.tsx` is `blocking` and is not edited. If the menu item
  cannot open the flow without editing it, the slice that does so becomes
  `evidence-affecting`.
- **Acceptance.**
  - [ ] Export and import of a Case Archive use the same noun wherever they appear.

## Slice 4.4: reconcile the open redesign issues

The maintainer ruled on the bundle on 2026-11-17, and answer 7 of decision 7 in the parent
plan gives the verdicts on both issues.

- [x] #1555: for each of its rows, write on the issue whether the bundle keeps, changes or
  supersedes it. Done as a comment on the issue on 2026-11-19. The row "Menu: which item opens
  the dialog" is superseded by 4.2. One entry supersedes the export menu row, the preview card
  is not drawn, and the dialog keeps its width.
- [x] #1547: the same, for the Overview's tag cards, against frame I, which supersedes the
  Selectors and Tags cards and keeps the heading, sources and capture strip rows. Done as a
  comment on the issue on 2026-11-19.
- [ ] #846: the dialog hardcodes zip while two other formats are unreachable. The new dialog
  offers no other format, and a comment on the issue of 2026-11-19 asks the maintainer whether
  the unreachable formats are removed from the main side, which is an `evidence-affecting`
  change of its own.
- [ ] #841: #2232 deleted `ExportMenu.tsx` and its tests, so nothing is left to move. A comment
  on the issue of 2026-11-19 asks the maintainer whether to close it.
- [ ] #1524: slice 1.2 makes the Trusted Time line readable in both themes and the copy cut
  removes the Working Copy notice, but not with the tokens the issue's brief names. A comment
  on the issue of 2026-11-19 asks the maintainer whether to close it.
