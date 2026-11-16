# Consolidation phase 4: export through one dialog

**Status:** active

This is the detail plan for phase 4 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). Export
labels do not name their outputs today (finding U3), seven nouns name what two controls produce
(C1), and two icons stand for the same dialog (C2). This phase puts the ruled nouns on every
label, then gives export one entry and one dialog. Code references are to `origin/main` at
`03668a1`.

Slice 4.1 is copy and can start at once. Slices 4.2 to 4.4 wait for frame G and question 7 of
`docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md`.

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
  the test itself, which shows the two evidence presets differ by exactly `notes.md`, is not
  touched.
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
- **Evidence tier.** `blocking` through `ExportDialog.tsx`. The Evidence impact section says
  labels only, and the export specs show the package for the same selection is unchanged.
- **Acceptance.**
  - [ ] Every label that names an export's output uses the `CONTEXT.md` term.
  - [ ] No UI label or docs line uses a venue word for the third preset.
  - [ ] An Evidence Package exported before and after the change, from the same Case and
    selection, has the same Package Layout.

## Slice 4.2: one "Export" entry and one dialog

Finding U3. Waits for the bundle.

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
- **Known-answer test.** `tests/main/services/export.test.ts` already shows, at the byte level,
  that an Evidence Package without Notes differs from one with them by exactly `notes.md`; the
  checkbox rests on that. A new unit test pins three equalities against the selections on `main`:
  Evidence Package with Notes equals today's `full` selection; with the checkbox ticked it
  equals today's third preset's selection; Working Copy equals today's `working` selection.
  `e2e/export.spec.ts` exports each and runs Package Verification on the two Evidence Packages.
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
  - [ ] A Case Archive exported from the dialog imports on a second profile, as
    `case-archive.spec.ts` checks today.

## Slice 4.3: Import beside Export

- **Change.** After 4.1 the dashboard button reads "Import Case Archive…". When slice 5.3 of
  the parent plan adds the Case menu, it carries the same item. This slice adds nothing else;
  it exists so the noun changes in one place and the menu item is not forgotten.
- **Files.** None beyond 4.1 until 5.3 lands.
- **Evidence tier.** `ImportCaseDialog.tsx` is `blocking` and is not edited.
- **Acceptance.**
  - [ ] Export and import of a Case Archive use the same noun wherever they appear.

## Slice 4.4: reconcile the open redesign issues

After the maintainer rules on the bundle.

- [ ] #1555: for each of its rows, write on the issue whether the bundle keeps, changes or
  supersedes it. The row "Menu: which item opens the dialog" is superseded by 4.2. The rows on
  the primary button's label, the dialog's width and the chain-of-custody preview card depend
  on frame G.
- [ ] #1547: the same, for the Overview's tag cards, against frame I.
- [ ] #846: the dialog hardcodes zip while two other formats are unreachable. Decide with the
  bundle whether those formats become choices or are removed from the main side.
- [ ] #841: closed by 4.2.
- [ ] #1524: closed by slice 1.2 of the parent plan.
