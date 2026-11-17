# Consolidation phase 5: one row of chrome

**Status:** active

This is the detail plan for phase 5 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). The
critique found a Case action bar that held one label and three buttons at rest and overflowed
during a Capture Session (finding U5), no primary control for capturing (U4), an icon-only rail
(H1), and a Case name that looks like a menu but opens the command palette (H2). This phase ends
with one row: the top bar. Code references are to `origin/main` at `ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan, the review notes left on #2201, and
#2205. #2205 moved Share, Export and Launch browser from `CaseActionBar.tsx` into `TopBar.tsx`,
so the parent plan's file names for slices 5.3 to 5.5 no longer match the code. This plan
follows the code.

Slice 5.1 can start at once. Slices 5.2 to 5.6 wait for the maintainer's ruling on
`docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md`, frames A to D and questions 1,
3, 6, 8, 9 and 10. Slices 5.4 and 5.5 also wait for the parent plan's open question 1. They go
in the order written: each one leaves the app working, and the row under the top bar is removed
only when nothing is left in it.

The rules every slice follows are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces".

## Where each control goes

| Today | In | Goes to | Slice |
| --- | --- | --- | --- |
| Section name | `CaseActionBar.tsx`, `SECTIONS` | The rail's labels | 5.2 |
| Settings gear and update dot | `TopBar.tsx` | The foot of the rail | 5.2 |
| Share pill | `TopBar.tsx`, `SharePill.tsx` | The Case menu; sync state per question 8 | 5.3 |
| Export | `TopBar.tsx`, `ExportMenu.tsx` | The Case menu | 5.3 |
| Case switcher | `TopBar.tsx`, the Case name | The Case menu's first item | 5.3 |
| Launch browser | `TopBar.tsx`, on Case screens | Filled, on every screen | 5.4 |
| Recording mark | `CaseActionBar.tsx`, `TopBar.tsx` | The running state of that control | 5.4 |
| Capture Session button | `TopBar.tsx`, `CaptureSessionButton.tsx` | Replaced by that control | 5.4 |
| Capture Session switch | `SessionControls.tsx` | Per the parent plan's open question 1 | 5.5 |
| The label after the switch | `SessionControls.tsx` | Per the bundle's question 10 | 5.5 |

## Slice 5.1: a shared menu component

Finding C5. No layout changes, so it does not wait for the bundle.

The parent plan counts three hand-built menus and moves four. Six components under
`src/renderer/components/` build a `role="menu"` by hand, each with its own keyboard handling:

- `ExportMenu.tsx`;
- `CaptureDownloadMenu.tsx`;
- `CaptureMenu.tsx`;
- the Capture actions menu in `CaptureDetailsPanel.tsx`;
- `dashboard/CaseMenu.tsx`, the dashboard card's menu, with arrow keys and Escape of its own;
- `captures/BatchTagPopover.tsx`.

`EntityContextMenu.tsx` and `ui/context-menu.tsx` also carry the role. They are context menus
on the existing wrapper and are not part of this slice.

- **Change.** Add `src/renderer/components/ui/menu.tsx` on the dropdown menu the `radix-ui`
  package already exports, the way `popover.tsx` and `context-menu.tsx` wrap theirs, and
  export it from `ui/index.ts`. It takes the look the hand-built menus share today. Move menus
  onto it, keeping their test ids, in two pull requests:
  - **5.1a.** The component, then `ExportMenu.tsx` (unless slice 4.2 has already made it a
    plain button), `CaptureMenu.tsx` (unless slice 1.4 has already reduced it to a button), and
    the Capture actions menu in `CaptureDetailsPanel.tsx`.
  - **5.1b.** `CaptureDownloadMenu.tsx` alone. The file is `blocking`, so this pull request is
    `evidence-affecting` and stays small enough to review as one.
- **Left for later.** `CaseMenu.tsx` moves in slice 5.3, which decides how it relates to the
  Case menu on the Case name. `BatchTagPopover.tsx` is a popover that lists Tags; moving it is
  not planned, and the slice says so in its pull request.
- **Behaviour to keep.** `ExportMenu.tsx` hands focus back to its button before a dialog
  opens, so the dialog has an opener to return focus to. The component has to do the same.
- **Files.** The new component, `ui/index.ts`, and the four menus.
- **Tests.** `tests/components/ExportMenu.test.tsx`, `CaptureDownloadMenu.test.tsx`,
  `CaptureMenu.test.tsx`, `CaptureDetailsPanel.test.tsx`: arrow keys, Home, End and Escape move
  and close as a menu should; focus returns to the trigger. This answers #938.
- **Screenshots.** Each menu open, before and after. They should match.
- **Evidence tier.** 5.1b is `blocking` through `CaptureDownloadMenu.tsx`, which the assessment
  lists as the per-Capture evidence export surface. The parent plan's Risks section counts four
  slices that edit `blocking` files and leaves this one out; it is the fifth. The Evidence
  impact section says markup and keyboard handling only, and a test shows each item hands over
  the same file as before.
- **Acceptance.**
  - [ ] The four menus are built on the shared component.
  - [ ] Each migrated menu passes the same keyboard cases.
  - [ ] Each Download menu item hands over the same file as before.
  - [ ] #938 is closed by the pull request, or the pull request says what is left of it.

## Slice 5.2: a labelled rail that holds Settings

Finding H1.

- **Change.**
  - `Sidebar.tsx`: each item shows its label under its icon. The hover tooltips go, since the
    labels say the same. Settings sits at the foot, with the update dot `TopBar.tsx` draws
    today as `topbar-update-dot`. The `nav-*` tour anchors stay on the buttons.
  - `TopBar.tsx` loses the gear.
  - The rail's width follows the bundle's answer to question 3. `SIDE_RAIL_PX` in
    `captureColumns.ts` takes the same value, which moves `DETAILS_FOLD_ROOM_PX` and what
    `CaptureSessionDock.tsx` and the Captures route measure.
- **Files.** `src/renderer/components/layout/Sidebar.tsx`,
  `src/renderer/components/layout/TopBar.tsx`,
  `src/renderer/components/captures/captureColumns.ts`.
- **Tests.** No test file covers `Sidebar.tsx` today; add `tests/components/Sidebar.test.tsx`
  for the labels, the active state and Settings. Update `TopBar.test.tsx` ("orders Share,
  Export, Launch browser, the status group and Settings"),
  `tests/renderer/captureColumns.test.ts` and `CaseSettingsEntryPoints.test.tsx`. End to end:
  `topbar-layout.spec.ts` and `onboarding-tour.spec.ts`.
- **Screenshots.** Each section and the dashboard at 1440 and 1100, before and after.
- **Docs.** `tester-guide.mdx` says "click the house icon (**Home**) at the top of the left
  sidebar"; with labels it can name the item.
- **Evidence tier.** Renderer chrome.
- **Acceptance.**
  - [ ] Every rail item has a visible label.
  - [ ] Settings opens from the rail and shows the update dot when an update is available.
  - [ ] The details panel and the Capture Session rail fold at widths that keep the same
    content minimums as before.
- **Not here.** An Investigate item. See `docs/plans/2026-11-15-investigate-entry-point.md`.

## Slice 5.3: the Case name opens a Case menu

Findings H2 and U10. Decision 1.

- **Change.**
  - The breadcrumb button in `TopBar.tsx` opens a menu built on 5.1's component:
    - Switch Case…, with the command palette's shortcut;
    - Share…, or Members once the Case is shared, with the state text `sharePillModel`
      computes;
    - Export…, which opens `ExportDialog`;
    - Import Case Archive… (slice 4.3 of the parent plan);
    - Case settings.
  - `TopBar.tsx` loses the Share pill and the export menu, which #2205 put there.
  - A Shared Case's sync state shows where the bundle's question 8 puts it. A sync error must
    stay visible without opening the menu.
  - The tour's `caseswitcher` step keeps ringing the Case name. The `export` step and the
    anchor in `ShareCoachMark.tsx` follow the bundle's question 6.
- **The name is taken.** `src/renderer/components/dashboard/CaseMenu.tsx` is already the
  dashboard card's menu: Rename, Share this Case… or Members, and Delete. It computes its
  sharing label with `caseMenuSharingLabel`. The bundle's question 9 rules whether the two are
  one component with different items or two menus that share the sharing label. Either way the
  new one takes a name that does not collide, and `CaseMenu.tsx` moves onto 5.1's component
  here.
- **Files.** `TopBar.tsx`, `SharePill.tsx` or what replaces it, `CaseMenu.tsx`,
  `ShareCoachMark.tsx`, `tourSteps.ts`.
- **Tests.** `TopBar.test.tsx` ("opens the case switcher from the case name" becomes the menu;
  "orders Share, Export, Launch browser, the status group and Settings" loses the first two),
  `ShareCoachMark.test.tsx`, `OnboardingTour.test.tsx`, `TourEntryPoints.test.tsx`,
  `tests/renderer/tourSteps.test.ts`, `CaseSettingsEntryPoints.test.tsx`,
  `CommandPalette.test.tsx`. End to end: `onboarding-tour.spec.ts`,
  `shared-case-members.spec.ts` (which finds `share-pill`), `export.spec.ts`,
  `case-archive.spec.ts`, `topbar-layout.spec.ts`.
- **Screenshots.** The menu open on an unshared Case and on a Shared Case in each sync state,
  and the tour's export step, before and after.
- **Docs.** `tester-guide.mdx` says "click **Share** in the top bar"; `features.mdx` where it
  places Export.
- **Evidence tier.** Renderer chrome. `ExportDialog.tsx` and `ImportCaseDialog.tsx` are
  opened, not edited.
- **Acceptance.**
  - [ ] Share, Export, Import and Case settings are each one click from the Case name.
  - [ ] The command palette's shortcut still switches Case.
  - [ ] A sync error on a Shared Case is visible with the menu closed.
  - [ ] The tour completes, and the Share coach mark points at something on screen.

## Slice 5.4: one primary capture control in the top bar

Findings U4 and C4. Decision 4. Waits for the parent plan's open question 1.

Since #2205 `TopBar.tsx` already renders Launch browser on Case screens, as an outline button
that is disabled while a launched browser is open. This slice changes its weight, its reach and
what it becomes while a session runs.

- **Change.**
  - The control in `TopBar.tsx` shows on every route:
    - at rest, a filled "Launch browser" button that opens the launch dialog for the Case on
      screen, and a menu beside it with "Paste URLs…", an Extension row and an Egress row
      carrying the status popover's wording;
    - with no Case open, what the bundle's question 1 rules;
    - while a Capture Session runs, the recording mark. On a Case it shows or hides the Capture
      Session panel. On the dashboard and in Settings it opens the popover
      `CaptureSessionButton.tsx` opens today.
  - It replaces `CaptureSessionButton.tsx` and the two places `TopBar.tsx` renders
    `RecordingMark` by itself.
  - `CaseActionBar.tsx` loses the mark.
- **The menu starts no Capture Session.** As listed, it launches a browser, which starts a
  session, and it pastes URLs. Nothing in it starts an extension-only session. The parent
  plan's open question 1 decides whether it gains an item that does, and the item keeps the
  warning ADR-0032 VPN rule 3 requires before a start.
- **Files.** A new component under `src/renderer/components/status/`, `TopBar.tsx`,
  `CaseActionBar.tsx`, `CaptureSessionButton.tsx` (removed), `RecordingMark.tsx`.
- **Tests.** `TopBar.test.tsx`, whose "Launch browser", "the Capture Session button" and "the
  recording mark" groups move to the new control; `RecordingMark.test.tsx`;
  `CaseActionBar.test.tsx`; `StartDialog.test.tsx` for the opener. End to end:
  `topbar-layout.spec.ts`.
- **Screenshots.** The top bar at rest, with the menu open, and recording, on a Case, the
  dashboard and Settings, at 1440 and 1100, before and after.
- **Docs.** `features.mdx` says "In a browser you start from a Case with **Launch browser**";
  the wording holds, the position changes.
- **Evidence tier.** Renderer chrome. The launch itself is `StartDialog.tsx` and main.
- **Acceptance.**
  - [ ] Exactly one filled button is in the chrome at rest, and it starts a capture.
  - [ ] The recording mark is the only recording indicator in the chrome.
  - [ ] From any screen, one click on the mark reaches the session's stop control.

## Slice 5.5: remove the row under the top bar

Findings U5 and U1. Waits for the parent plan's open question 1 and lands with whatever takes
over the start of an extension-only session.

- **Change.**
  - By now `CaseActionBar.tsx` holds the section name and `SessionControls`. The rail names the
    section since 5.2.
  - An extension-only Capture Session starts where the answer to open question 1 puts it. The
    start path keeps `confirmContact(…, 'session')`, the warning ADR-0032 VPN rule 3 requires,
    and activates the Case before starting, as `handleToggleSession` does. It stops from the
    capture control's menu.
  - The two facts the label after the switch still states go where the bundle's question 10
    puts them: the Active Case when it is not the Case on screen, and both sources when the
    extension is connected beside a launched browser. The maintainer chose to keep both in
    #2205, so neither is dropped with the row.
  - `CaseWorkspace.tsx` stops rendering the bar. `CaseActionBar.tsx` and `SessionControls.tsx`
    are deleted with their tests.
- **Files.** `src/renderer/components/dashboard/cases/CaseWorkspace.tsx`, the control from 5.4,
  and the two deleted components.
- **Tests.** `CaseActionBar.test.tsx`, `SessionControls.test.tsx` and
  `SessionControlsLaunchedBrowser.test.tsx` are removed; their cases for starting, stopping, the
  stop confirmation and the two label facts move to the control's tests.
  `e2e/topbar-layout.spec.ts` is rewritten for one row. `e2e/round1-session.spec.ts` starts its
  session the new way.
- **Screenshots.** Every section at 1440 and 1100, at rest and recording, before and after.
- **Evidence tier.** Renderer chrome.
- **Acceptance.**
  - [ ] A Case screen has one row of chrome above its content.
  - [ ] An extension-only session can be started and stopped, and its start still raises the
    VPN warning when one is due.
  - [ ] The window still names the Active Case when it is another Case, and both sources when
    two are connected.
  - [ ] No test id from the action bar is left in `e2e/`.

## Slice 5.6: docs and record

- [ ] `tester-guide.mdx` and `features.mdx` describe the positions as shipped.
- [ ] `website/content/docs/screenshots.mdx` shows the old chrome in its images.
  `e2e/readme-screenshots.spec.ts` writes fresh ones under `test-results/readme`; rerun it and
  replace the images the page uses.
- [ ] The index in `docs/design-handoff/README.md` names the bundle as superseding the
  2026-11-08 top bar and the rows of the 2026-08-21 standalone it replaces. No earlier bundle
  records a supersession of standalone rows, and that README still calls the standalone the
  single design source, so this entry is the first of its kind and its wording is the
  maintainer's.
- [ ] The parent plan's slices 5.1 to 5.5 are ticked and its status line updated.
