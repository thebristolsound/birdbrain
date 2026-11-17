# Consolidation phase 2: a Capture Session has one place

**Status:** active

This is the detail plan for phase 2 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). During
a Capture Session one screen named the browser three times, the Case three times and the timer
twice, and offered two stop controls (finding U1). At 1440 pixels the layout reaches five columns
(finding U7). This phase makes the Capture Session panel the one place that describes a session.
Code references are to `origin/main` at `ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan, the review notes left on #2201, and
#2205. #2205 did part of slice 2.1 before this phase started, under a rule the maintainer chose,
so the parent plan's wording for 2.1 no longer matches the code. This plan follows the code.

Slices 2.1, 2.2 and 2.4 need no drawing and can start at once. Slice 2.3 waits for frames E and
F and questions 4 and 5 of
`docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md`.

The rules every slice follows are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces".

## What #2205 already changed

- Share, Export and Launch browser moved from `CaseActionBar.tsx` into `TopBar.tsx`. The row
  under the top bar keeps the section name, the recording mark and the Capture Session switch.
- The label after the switch (`session-source-line` in `SessionControls.tsx`) no longer shows
  in the normal case. It shows for two things nothing else in the window says:
  - the Active Case's name, when Captures go into a Case that is not the one on screen;
  - both sources, as "‹browser›, and the extension", when the extension is connected beside an
    open launched browser.
- The maintainer chose that rule on 2026-11-16, after review showed that removing the label
  outright lost both facts. No slice here removes it.

## What is on screen today

With a launched browser open and the extension connected, on the browser's own Case:

| Fact | Where | Source |
| --- | --- | --- |
| Browser name | The recording mark | `RecordingMark.tsx`, `source` |
| Browser name, "and the extension" | Beside the switch | `SessionControls.tsx`, `sources` |
| Browser name | The panel's header | `CaptureSessionPanel.tsx` |
| Case name | The breadcrumb | `TopBar.tsx` |
| Case name | "Into ‹Case›" in the panel | `CaptureSessionPanel.tsx` |
| Elapsed time | The recording mark and the panel title | `Elapsed` in both files |
| Stop | The Capture Session switch | `SessionControls.tsx` |
| Stop | **Stop** in the panel | `CaptureSessionPanel.tsx` |

`CaptureSessionDock.tsx` shows the panel only for a launched browser: `panelView` returns `none`
for an extension-only session, which therefore has no panel and no other stop control than the
switch. The switch is also the only control that starts an extension-only session; the launch
dialog starts a session only by launching a browser. The parent plan's open question 1 covers
what replaces that start.

## Slice 2.1: the mark says recording and for how long

Finding U1. Undoes part of #2125; the pull request says so.

- **Already done by #2205.** The Case name and the source line beside the switch, in the normal
  case.
- **Change.**
  - `RecordingMark.tsx`: the `source` text becomes a prop. `CaseActionBar.tsx` leaves it off
    while the Capture Session view is not `none`, because the panel on screen names the browser.
    It keeps it for an extension-only session, where no panel shows. `TopBar.tsx` keeps it on
    the dashboard and in Settings.
  - `TopBar.tsx`: while a launched browser is open, do not render Launch browser. It returns
    when the browser closes, as the test "offers it again once the launched browser has closed"
    expects.
- **Left as it is.** The label #2205 kept. With both sources connected it still names the
  browser a second time, beside the panel's header. Shortening it to name only the extension
  would change the rule the maintainer chose, so it is a question for the maintainer, not part
  of this slice.
- **Files.** `src/renderer/components/status/RecordingMark.tsx`,
  `src/renderer/components/layout/CaseActionBar.tsx`,
  `src/renderer/components/layout/TopBar.tsx`.
- **Tests.** `tests/components/RecordingMark.test.tsx`, `tests/components/CaseActionBar.test.tsx`
  and `tests/components/TopBar.test.tsx` (the order test loses Launch browser while a browser is
  open). `e2e/topbar-layout.spec.ts`: the test "fits the Case controls while a launched browser
  records" expects "Launched Google Chrome" in `topbar-rec`; that expectation moves to
  `capture-session-rail`. Its expectation on `session-source-line` stays.
- **Screenshots.** The Captures section at 1440 and 1100 with a launched browser recording, with
  both sources, and with an extension-only session, before and after.
- **Docs.** `features.mdx` describes the Capture Session panel; check it does not point at the
  row under the top bar for the browser's name.
- **Evidence tier.** Renderer chrome.
- **Acceptance.**
  - [ ] With the panel on screen and one source, the browser's name appears once, in the panel.
  - [ ] An extension-only session still names its source in the mark.
  - [ ] The top bar and the row under it fit at 1,024 pixels with a launched browser and the
    extension, with no truncation.

## Slice 2.2: one stop control on screen

Finding U1.

- **Change.** In `SessionControls.tsx` the switch does not render while the panel in view
  offers a stop control, which is `panelView`'s `open` and `closed` kinds. It still renders for
  an extension-only session and while the view is `none` or `notice`. The label #2205 kept is
  separate from the switch and still renders when its rule says so.
- **Check the `closing` kind.** `panelView` also has `closing`. Read what the panel offers
  there before choosing which side of the rule it falls on.
- **Why by kind and not by layout.** `CaptureSessionDock.tsx` shows the panel as a rail, a strip
  with an overlay, or a popped-out window. In all three the panel's **Stop** is at most one
  click away, so the rule reads the view, not the width.
- **Files.** `src/renderer/components/status/SessionControls.tsx`.
- **Tests.** `tests/components/SessionControlsLaunchedBrowser.test.tsx`: no switch for `open`
  and `closed`; a switch for an extension-only session; the label cases ("names the Active Case
  when it is not the Case on screen", "names both sources while the extension is connected
  beside a launched browser") still pass with no switch beside them.
  `e2e/topbar-layout.spec.ts`: the row list in the launched-browser test loses the switch.
  `e2e/round1-session.spec.ts` starts a session through the switch; confirm it runs
  extension-only and still passes.
- **Screenshots.** Same states as 2.1, taken after it.
- **Evidence tier.** Renderer chrome.
- **Acceptance.**
  - [ ] A launched-browser session shows one stop control, in the panel.
  - [ ] An extension-only session still starts and stops from the switch.
  - [ ] At no point is a running session more than one click from a stop control.

## Slice 2.3: Capture details and the Capture Session share one right panel

Finding U7. No longer waits: decision 7 of the parent plan ruled on the bundle on 2026-11-17,
and its answers 4 and 5 are the bundle's questions 4 and 5.

- **Today.** On Captures the details panel is a column of the resizable group in
  `src/renderer/routes/cases/$caseId/captures.tsx` (default 400 pixels, 320 to 680), and
  `CaptureSessionDock.tsx` adds a 320 pixel rail outside it. `captureColumns.ts` keeps the
  viewer at `DOCKED_VIEWER_MIN_PX` while the rail is docked and folds the details panel under
  `detailsFoldRoomPx`.
- **Change.**
  - On Captures, while the Capture Session view is not `none`, the details column hosts two
    tabs: "Details" and "Capture Session". The session tab renders
    `CaptureSessionPanel form="rail"`.
  - `CaptureSessionDock.tsx` renders no rail or strip of its own on Captures; a context value
    tells it the route hosts the panel. On every other section it behaves as today.
  - `captureColumns.ts` loses the docked-rail cases on Captures: `viewerMinPx` and
    `detailsFoldRoomPx` no longer take `railDocked` there. Whether `DOCKED_VIEWER_MIN_PX`
    survives is the bundle's question 5.
  - The folded strip shows the recording dot and the tab count, as `Strip` does today.
  - Pop out and Dock keep working from the tab.
- **Files.** `src/renderer/routes/cases/$caseId/captures.tsx`,
  `src/renderer/components/captures/captureColumns.ts`,
  `src/renderer/components/launchedBrowser/CaptureSessionDock.tsx`, and one new tab-strip
  component beside `CaptureDetailsPanel.tsx`.
- **Must not edit.** `CaptureControl.tsx`, `TabPicker.tsx` and `captureSessionPanelModel.ts`
  are `blocking`. If the slice has to change one, it takes the `evidence-affecting` label and
  an Evidence impact section.
- **Tests.** `tests/renderer/captureColumns.test.ts`,
  `tests/components/CaptureSessionDock.test.tsx`, `tests/components/CaptureSessionPanel.test.tsx`.
  A new end-to-end test in `e2e/topbar-layout.spec.ts`: at 1440 with a launched browser
  recording, Captures shows four columns and the viewer is wider than it is on `main`.
- **Screenshots.** Captures at 1440 and 1100 with a session, on each tab, folded and unfolded,
  before and after.
- **Docs.** `features.mdx`, where it says where the Capture Session panel sits.
- **Evidence tier.** `src/renderer/routes/**` is renderer chrome. `captureColumns.ts`,
  `CaptureSessionDock.tsx` and `CaptureSessionPanel.tsx` match no entry of the path list;
  confirm before starting.
- **Acceptance.**
  - [ ] Captures never shows more than four columns.
  - [ ] Both tabs are reachable by keyboard and announce as tabs.
  - [ ] Taking a Capture from the session tab behaves as it does from the rail today.
  - [ ] Notes, Signals, Data and the Overview show the Capture Session rail as before.

## Slice 2.4: say "into this Case" when the Case is on screen

Finding U1.

- **Change.** `CaptureSessionPanel.tsx` renders "Into ‹Case›" from `caseName`. When the route's
  Case is the browser's Case, render "Into this Case". The popover and window forms have no
  Case on screen and keep the name.
- **Files.** `src/renderer/components/launchedBrowser/CaptureSessionPanel.tsx`.
- **Tests.** `tests/components/CaptureSessionPanel.test.tsx`: the rail on the browser's own Case
  says "Into this Case"; the popover names the Case.
- **Screenshots.** The panel's header, before and after.
- **Evidence tier.** `CaptureSessionPanel.tsx` matches no entry of the path list; its model is
  `blocking` and is not touched. Confirm before starting.
- **Acceptance.**
  - [ ] On the browser's own Case the panel does not repeat the Case's name.
  - [ ] Wherever the Operator is not looking at that Case, the name is shown.
