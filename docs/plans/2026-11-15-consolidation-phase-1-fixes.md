# Consolidation phase 1: fixes that need no drawing

**Status:** active

This is the detail plan for phase 1 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). It holds
seven slices, each one pull request, none waiting on the design bundle or on another slice. Code
references are to `origin/main` at `03668a1`.

The rules every slice follows (screenshots, docs in the same pull request, the
`evidence-affecting` label) are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces". They are not restated here.

## Slice 1.1: raise faint text to 4.5:1 on dark surfaces

Finding A1. `--color-text-faint` is `#71717a` in the dark block of
`src/renderer/styles/globals.css`. It measures 3.99:1 on `--color-surface`, 3.84:1 on
`--color-card` and 3.51:1 on `--color-elevated`. The class `text-text-faint` appears 281 times,
about two thirds of them on text of 12 pixels or smaller.

- **Change.** Set the dark value to `#85858e`, which measures 5.27:1, 5.07:1 and 4.65:1 on the
  same three surfaces. Leave the light value: `#66666f` already measures 5.17:1 or better.
- **Check before choosing.** `--color-text-muted` is `#a1a1aa` in the dark theme. If the two
  steps read as one on screen, pick a darker passing grey, not a lighter muted step.
- **Files.** `src/renderer/styles/globals.css`.
- **Tests.** No unit test pins the value today. Add one beside `tests/renderer/` that computes
  the WCAG ratio of faint text against the three dark surfaces from the stylesheet and fails
  under 4.5.
- **Screenshots.** Captures with a Capture open, the Overview, and the launch dialog, dark
  theme, before and after.
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
filled boxes in the danger and warning triples.

- **Change.**
  - The heading and the footer with Cancel and `export-submit` stay fixed; the form between them
    scrolls.
  - Each filled notice becomes text with an icon in the matching `-fg` colour on the dialog's
    own surface, with a left rule if it needs separation. No tinted box.
  - The notices stay readable in the light theme, which resolves #1524.
- **Out of scope.** Wording, presets and which notices show. Phase 4 changes those.
- **Files.** `src/renderer/components/export/ExportDialog.tsx`.
- **Tests.** `tests/components/ExportDialog.test.tsx`: the footer is outside the scrolling
  element. `e2e/export.spec.ts`: at a 1440 by 900 window, `export-submit` is in the viewport
  when the dialog opens, with no scroll.
- **Screenshots.** The dialog at 1440 by 900 in both themes, for the demo Case and for a Case
  with Captures awaiting Trusted Time.
- **Evidence tier.** `blocking`. The Evidence impact section says layout and colour only; the
  export specs show the package for the same selection is unchanged.
- **Acceptance.**
  - [ ] `export-submit` is visible on open at 900 pixels of window height.
  - [ ] No notice in the dialog uses a `-surface` background.
  - [ ] Each notice's text is at least 4.5:1 in both themes.
  - [ ] #1524 is closed by the pull request.

## Slice 1.3: give a disabled Launch browser a reachable reason

Finding A3. `CaseActionBar.tsx` disables the button and puts `busyRefusal`'s title on a wrapper
`span`, which only a pointer reaches.

- **Change.** Use `aria-disabled` in place of `disabled`, ignore the click while refused, and
  point `aria-describedby` at a visually hidden element holding the reason. `ExportMenu.tsx`
  already uses `aria-disabled` this way. The `title` stays for pointer users.
- **Files.** `src/renderer/components/layout/CaseActionBar.tsx`.
- **Tests.** `tests/components/CaseActionBar.test.tsx`: while a browser is open the button is
  focusable, has an accessible description equal to the refusal's title, and does not call
  `openStartDialog`.
- **Screenshots.** None: the rendered result is the same. The pull request says so.
- **Evidence tier.** Renderer chrome.
- **Acceptance.**
  - [ ] A keyboard user can focus the button while it is refused and hears the reason.
  - [ ] Activating it while refused does nothing.
- **Note.** Slice 2.1 hides this button while a browser is open, and 5.5 removes the bar. This
  slice still pays for the time between.

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
- **Evidence tier.** `CaptureMenu.tsx` is not in the path list by name. Confirm its tier before
  starting: it enqueues background Captures.
- **Acceptance.**
  - [ ] Recapture is reachable from the Capture's own menus and the selection bar, and not from
    the add menu.
  - [ ] One click on the add button opens the paste dialog.
  - [ ] The Recapture end-to-end spec passes through the details menu.

## Slice 1.5: name the scope on the Data screen's Verify buttons

Finding U16. `DataExplorer.tsx` renders `node-verify` in the pane header and `row-verify` on
the selected Exhibit's pane, both labelled "Verify". `IntegrityStrip.tsx` already has
`verify-all`, labelled "Verify all".

- **Change.** `node-verify` reads "Verify listed" and keeps its title. `row-verify` reads
  "Verify this Exhibit". The three buttons then name three scopes.
- **Files.** `src/renderer/components/dashboard/cases/DataExplorer.tsx`.
- **Tests.** `tests/components/DataExplorer.test.tsx` finds the buttons by test id, so only
  assertions on the label change.
- **Screenshots.** The Data screen with a row selected, before and after.
- **Evidence tier.** `blocking`. Labels only; what Verify checks and reports is unchanged, and
  the Evidence impact section says so.
- **Acceptance.**
  - [ ] No two controls on the Data screen share the label "Verify".
  - [ ] Each button verifies the same Exhibits as before.

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
- **Evidence tier.** `StartDialog.tsx` is not in the path list by name. Confirm before starting.
- **Acceptance.**
  - [ ] One found browser shows as text.
  - [ ] Two or more still show the select, and the chosen browser launches.

## Slice 1.7: settle the two "All notes" links on the Overview

Finding H3. `BacklinkMap.tsx` ends its header with a link reading "All notes", and
`CaseOverview.tsx` gives the Quick Notes card the same action. Both open the Notes section. The
critique read the first as a wrong label; it is a duplicate.

- **Change.** Check the standalone mock first. If it draws both links, leave both and close H3
  as ruled by the mock. If it draws one, remove the Link Map's and keep "Clear focus" in its
  place when a focus is set.
- **Files.** `src/renderer/components/overview/BacklinkMap.tsx`.
- **Tests.** `tests/components/BacklinkMap.test.tsx`.
- **Screenshots.** The Overview's top row, before and after, if anything changes.
- **Evidence tier.** Not evidence-affecting.
- **Acceptance.**
  - [ ] The pull request states what the mock draws and which way that settled it.
