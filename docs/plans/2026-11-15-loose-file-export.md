# Loose-file export

**Status:** active

The consolidation plan (`docs/plans/2026-11-15-chrome-capture-export-consolidation.md`, #2201)
gives export one dialog with three choices: Evidence Package, Working Copy and Case Archive.
Its decision 6 keeps a fourth choice, loose files, out of that dialog and leaves it to #830.
This plan covers what that decision set aside: the controls that hand over a single file or a
CSV, where they sit today, and how they could come together once #830's first decision is
taken. Code references are to `origin/main` at `ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan, whose decision 6 is unchanged.

Nothing here is ruled. The plan ends in questions for the maintainer, and its slices start only
after them.

## What counts as a loose file

A file or text that leaves Birdbrain with no Manifest, no Certification and no Package Layout.
It is neither an Evidence Package nor a Working Copy as `CONTEXT.md` and ADR-0010 define them.

## Where loose files leave today

| Scope | Control | Where | Output |
| --- | --- | --- | --- |
| One Capture | Download menu: MHTML archive, PDF report, Screenshot (PNG) | `CaptureDownloadMenu.tsx` | One stored file, or a rendered PDF |
| One Selector | Export matches to CSV | `entityMenu.ts`, `selectorMenuEntries` | CSV of its Persisted Matches |
| One Selector | Export CSV | `SignalDetailRail.tsx` | The same CSV |
| All Selectors | Export all | `SignalsOverview.tsx` | CSV of every Persisted Match |
| One Tag | Export… then Copy as markdown | `entityMenu.ts`, `tag-copy-markdown` | Clipboard text |
| A database table | Export Table | `DbUtilities.tsx` | CSV or JSON |
| Logs | Export logs | `DiagnosticsPanel.tsx` | A log bundle |

The last two are maintenance tools in Settings and stay out of this plan.

Two things about the first five matter for what follows:

- `CaptureDownloadMenu.tsx` and `src/main/services/csvEscape.ts` are `blocking` in
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`. A CSV of matches and a PDF
  report are read by people outside Birdbrain as records of a Case.
- The Tag menu's drill-down carries a comment that other destinations "remain under the
  recorded #830 ruling". #830 asks for an inline export route per Capture, Note, Selector and
  Tag, and names its own first decision: which of the mock's six drill-down items ship per
  kind. #830 was blocked by #401, which has since closed; it is `ready-for-human` and
  `evidence-affecting`.

## The problem to solve

The critique's finding U3 was that an Operator cannot predict what an export control produces.
Slices 4.1 and 4.2 of the consolidation plan fix that for packages. For loose files the same
problem remains in a smaller form:

- the same CSV has two buttons and a menu row with three labels;
- "PDF report" on one Capture and the report inside an Evidence Package are different
  documents with one word in common;
- nothing on a loose file says it is not an Evidence Package.

## Questions for the maintainer

1. **Do loose files join the export dialog as a fourth choice, or stay as quick controls beside
   the thing they export?** A fourth choice gives one door. Quick controls keep a one-click
   path for the most common need, a screenshot or a page archive of the Capture on screen.
   Recommendation: keep the viewer's Download menu as the quick path, and route every other
   loose-file control through the dialog with its scope filled in.
2. **Does a loose file say what it is not?** An Evidence Package states its Certification; a
   Working Copy is labelled non-evidentiary (ADR-0010). A CSV of matches carries no such
   statement. Recommendation: a first line or a sidecar note that names the Case, the time and
   that the file is not an Evidence Package. This changes file content, so it is
   evidence-affecting and needs its own known-answer test.
3. **Which of #830's drill-down items ship per kind?** #830 leaves this to its branch. It
   should be settled before any slice below starts, since it fixes the list of outputs.
4. **Is "PDF report" the right name for the per-Capture PDF?** ADR-0043 says export documents
   are factual records. If the per-Capture PDF and the package's report differ in content, they
   should differ in name.

## Slices, after the questions are answered

Each is one pull request and follows the rules in the consolidation plan under "Slices".

- [ ] **L1. One label per output.** The same CSV reads the same on its button, its rail button
  and its menu row. The per-Capture PDF takes the name question 4 gives it. Copy only.
  `blocking` through `CaptureDownloadMenu.tsx` if its labels change.
- [ ] **L2. Per-entity routes open the one dialog.** #830's registry entries in `entityMenu.ts`
  open `ExportDialog` with the scope filled in: this Capture, this Note, this Selector's
  Captures, this Tag's Captures. Depends on slice 4.2 of the consolidation plan. This is
  #830's deliverable; the slice lands under that issue. What happens to a loose output on those
  routes follows question 1. If loose files stay as quick controls, the dialog holds no loose
  choice, so the Selector's CSV row and the Tag's "Copy as markdown" keep their own rows in
  `entityMenu.ts` beside the item that opens the dialog; the table above lists no loose output
  for a Note. If they become a fourth choice, those rows go and L3's "Files" choice lists them.
- [ ] **L3. The "Files" choice, if question 1 says yes.** A fourth choice in the dialog that
  lists the loose outputs available for the scope, each with its file type. Needs a frame in
  the design bundle
  (`docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md` does not draw it today).
- [ ] **L4. A statement on each loose file, if question 2 says yes.** Main-side, in the writers
  behind the CSV and the PDF. `blocking`: Evidence impact section, known-answer tests for the
  new first line, and a check that an existing consumer of the CSV still parses it.
  `tests/main/services/exportKnownAnswer.test.ts` pins package and report bytes and has no case
  for a loose CSV or a per-Capture PDF, so the slice adds its own.

## Tests and evidence

- Label changes: `tests/components/CaptureDownloadMenu.test.tsx`, `entityMenu.test.tsx`,
  `SignalsOverview.test.tsx`, `SignalDetailRail.test.tsx`.
- Any change to what a file contains: a known-answer test beside the writer, and the pull
  request waits for the maintainer's review, as #830 already says of itself.
- Screenshots for every control whose label or position changes.

## Acceptance

- [ ] Each loose output has one name wherever it is offered.
- [ ] From any Capture, Note, Selector or Tag, export of a package is one menu item that opens
  the same dialog. Under the quick-controls answer to question 1, each loose output keeps one
  row of its own beside it. Under the fourth-choice answer, it is in the dialog and has no
  other row.
- [ ] If question 2 is yes, every loose file states that it is not an Evidence Package.
- [ ] #830 is closed, or rewritten to what is left.
