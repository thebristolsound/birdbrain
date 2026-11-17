# Consolidation phase 1: fixes that need no drawing

**Status:** active

This is the detail plan for phase 1 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). It holds
six slices, each one pull request, none waiting on the design bundle or on another slice. Slice
1.5 waits for the parent plan's open question 2. Code references are to `origin/main` at
`ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan, the review notes left on #2201, and
#2205, which moved Launch browser into the top bar.

The rules every slice follows (screenshots, docs in the same pull request, the
`evidence-affecting` label) are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces". They are not restated here.

## Slice 1.1: raise faint text to 4.5:1 on dark surfaces

Finding A1. `--color-text-faint` is `#71717a` in the dark block of
`src/renderer/styles/globals.css`. It measures 3.99:1 on `--color-surface`, 3.84:1 on
`--color-card` and 3.51:1 on `--color-elevated`. The class `text-text-faint` appears 284 times
in 100 files under `src/renderer/`. Sixteen more class uses take the token as a background or a
border: `bg-text-faint` on switch tracks and status dots, and one `border-text-faint`.

- **Change.** Set the dark value to `#85858e`, which measures 5.27:1, 5.07:1 and 4.65:1 on the
  same three surfaces. Leave the light value: `#66666f` already measures 5.17:1 or better.
- **Check before choosing.** `--color-text-muted` is `#a1a1aa` in the dark theme. If the two
  steps read as one on screen, pick a darker passing grey, not a lighter muted step.
- **Check the non-text uses.** A lighter token also lightens the sixteen backgrounds and
  borders. Look at one switch track and one status dot in the after screenshots.
- **Files.** `src/renderer/styles/globals.css`.
- **Tests.** No unit test pins the value today. Add one beside `tests/renderer/` that computes
  the WCAG ratio of faint text against the three dark surfaces from the stylesheet and fails
  under 4.5.
- **Screenshots.** One screen per section, the launch dialog, and a screen with a switch track
  and a status dot, dark theme, before and after.
- **Evidence tier.** Styling. Not evidence-affecting.
- **Acceptance.**
  - [ ] Faint text is at least 4.5:1 on `--color-surface`, `--color-card` and
    `--color-elevated` in the dark theme.
  - [ ] The light theme renders as before.
  - [ ] Faint and muted text are still two distinct steps in the after screenshots.

## Slice 1.2: keep the Export dialog's primary action in view

Findings U9 and C3. The dialog in `ExportDialog.tsx` is one scrolling box (`max-h-[85vh]` with
`overflow-y-auto`), so at 900 pixels of window height `export-submit` starts below the fold. The
demonstration notice (`export-demo-notice`), the Working Copy notice
(`export-working-copy-notice`), the Trusted Time preflight notice and the failure notice are
filled boxes in the danger and warning triples. This is the only dialog C3 applies to: the
launch dialog's no-VPN line is already plain text.

- **Change.**
  - The heading and the footer with Cancel and `export-submit` stay fixed; the form between them
    scrolls.
  - Each filled notice becomes text with an icon in the matching `-fg` colour on the dialog's
    own surface, with a left rule if it needs separation. No tinted box.
  - The notices stay readable in the light theme, which resolves #1524.
- **Out of scope.** Wording, presets and which notices show. Phase 4 changes those.
- **Files.** `src/renderer/components/export/ExportDialog.tsx`.
- **Tests.** `tests/components/ExportDialog.test.tsx`: the footer is outside the scrolling
  element, and the preset tests pass unedited. `e2e/export.spec.ts`: at a 1440 by 900 window,
  `export-submit` is in the viewport when the dialog opens, with no scroll.
- **Screenshots.** The dialog at 1440 by 900 in both themes, for the demo Case and for a Case
  with Captures awaiting Trusted Time.
- **Evidence tier.** `blocking`. The Evidence impact section says layout and colour only.
  `e2e/export.spec.ts` reads the names of a package's entries, not their bytes, so it does not
  show a package is unchanged. The slice shows instead that the dialog submits the same options:
  the preset tests pass unedited, nothing under `src/main/` changes, and
  `tests/main/services/exportKnownAnswer.test.ts` passes unedited.
- **Acceptance.**
  - [ ] `export-submit` is visible on open at 900 pixels of window height.
  - [ ] No notice in the dialog uses a `-surface` background.
  - [ ] Each notice's text is at least 4.5:1 in both themes.
  - [ ] #1524 is closed by the pull request.

## Slice 1.3: give a disabled Launch browser a reachable reason

Finding A3. Since #2205 the button is in `TopBar.tsx`, not `CaseActionBar.tsx` as the parent
plan says. It takes `disabled` while `launchBusy` is set and puts `busyRefusal`'s title on a
wrapper `span`, which only a pointer reaches.

- **Change.**
  - The button takes `aria-disabled` in place of `disabled`, so it keeps focus.
  - `aria-disabled` does not stop a click or a key press, and the handler calls
    `openStartDialog` without looking at `launchBusy`. The handler returns early while the
    launch is refused.
  - `aria-describedby` points at a visually hidden element holding the reason. The `title` stays
    for pointer users.
- **Models.** `ExportMenu.tsx` shows the first half only: it sets `aria-disabled` and gives its
  reason in a `title`. `OperatorConfig.tsx` shows `aria-describedby` wired to a message.
- **Files.** `src/renderer/components/layout/TopBar.tsx`.
- **Tests.** `tests/components/TopBar.test.tsx`, in the "Launch browser" group: while a browser
  is open the button is focusable and has an accessible description equal to the refusal's
  title, and neither a click nor Enter or Space calls `openStartDialog`.
- **Screenshots.** None: the rendered result is the same. The pull request says so.
- **Evidence tier.** Renderer chrome.
- **Acceptance.**
  - [ ] A keyboard user can focus the button while it is refused and hears the reason.
  - [ ] Activating it while refused, by pointer or by keyboard, does nothing.
- **Note.** Slice 2.1 hides this button while a browser is open, and 5.4 replaces it. This slice
  still pays for the time between.

## Slice 1.4: take Recapture out of the add menu

Finding U13. `CaptureMenu.tsx` offers "Paste URLs to capture…" and "Recapture current page".
Recapture acts on the selected Capture and already has four other places: the Capture's menu in
`CaptureDetailsPanel.tsx` (`capture-details-recapture-btn`), `CaptureSelectionBar.tsx`, and
the Capture and capture-log context menus that `entityMenu.ts` builds.

- **Change.** Remove the `recapture-btn` item and its state from `CaptureMenu.tsx`. With one
  item left, the add button opens the paste dialog directly and its title says "Paste URLs to
  capture".
- **Files.** `src/renderer/components/captures/CaptureMenu.tsx`.
- **Tests.** `tests/components/CaptureMenu.test.tsx` drops the Recapture cases and adds the
  direct open. `e2e/recapture.spec.ts` uses `recapture-btn`; it moves to
  `capture-details-recapture-btn`.
- **Screenshots.** The Captures list header with the menu open before, and the paste dialog
  after.
- **Docs.** Check `tester-guide.mdx` and `features.mdx` for a step that reaches Recapture
  through the add button.
- **Evidence tier.** `CaptureMenu.tsx` matches no entry of the path list. Confirm its tier
  before starting: it enqueues background Captures.
- **Acceptance.**
  - [ ] Recapture is reachable from the Capture's own menus and the selection bar, and not from
    the add menu.
  - [ ] One click on the add button opens the paste dialog.
  - [ ] The Recapture end-to-end spec passes through the details menu.

## Slice 1.5: name the scope on the Data screen's Verify buttons

Finding U16. Waits for the parent plan's open question 2: the labels are the maintainer's, and
this plan no longer proposes any.

`DataExplorer.tsx` renders two buttons labelled "Verify":

- `node-verify`, in the header above the table, passes `nodeExhibitIds` to `verifyIds`. That is
  the Exhibits among the rows of the selected node. On the top-level nodes (`data-sources`,
  `views`, `file-types`, `results`) `rowsForNode` returns every anchored row, so there the
  button verifies the same set as `verify-all`. On a narrower node it verifies a subset.
- `row-verify`, on the selected row's pane, passes `selectedExhibitId`. For a derived file that
  is `parentExhibitId`, the Exhibit the file came from, not the file.

`IntegrityStrip.tsx` already labels `verify-all` "Verify all".

The parent plan's open question 2 says `node-verify` never covers the whole Case. On the
top-level nodes it does, so a label that implies a subset would understate what was verified
there. The answer to the question has to hold for both cases.

- **Change.** Each button gets the label the maintainer rules. No behaviour changes.
- **Files.** `src/renderer/components/dashboard/cases/DataExplorer.tsx`.
- **Tests.** `tests/components/DataExplorer.test.tsx` finds the buttons by test id, so only
  assertions on the label change. Add a case that pins what each button passes to `verifyIds`
  on a top-level node, on a narrower node, and for a derived file.
- **Screenshots.** The Data screen with a row selected, before and after.
- **Evidence tier.** `blocking`. Labels only. The Evidence impact section shows that each label
  matches the Exhibits its button passes to `verifyIds`.
- **Acceptance.**
  - [ ] No two controls on the Data screen share the label "Verify".
  - [ ] Each button verifies the same Exhibits as before.
  - [ ] Each label is true on a top-level node, on a narrower node and for a derived file.

## Slice 1.6: show a single browser as text in the launch dialog

Finding U15. `StartDialog.tsx` renders a native `select` with `id="launch-browser-select"` even
when one browser was found.

- **Change.** With one option, render its label as text in the same row, keeping the version
  line under it. Keep the select for two or more. `autoFocus` moves to the primary button when
  the select is absent.
- **Files.** `src/renderer/components/launchedBrowser/StartDialog.tsx`.
- **Tests.** `tests/components/StartDialog.test.tsx`: one browser renders no `combobox`; two
  render one; focus lands on Launch when the select is absent.
- **Screenshots.** The launch dialog with one browser, before and after.
- **Evidence tier.** `StartDialog.tsx` matches no entry of the path list. Confirm before
  starting.
- **Acceptance.**
  - [ ] One found browser shows as text.
  - [ ] Two or more still show the select, and the chosen browser launches.

## Dropped: the two "All notes" links on the Overview

An earlier draft of this plan had a slice 1.7 for finding H3. The parent plan now leaves H3
alone: both links call `goToNotes` in `CaseOverview.tsx` and open the Notes section, as their
label says, and the critique recommended no change. Nothing is planned.
