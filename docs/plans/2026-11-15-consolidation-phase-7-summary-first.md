# Consolidation phase 7: summary first, and pointers instead of copies

**Status:** active

This is the detail plan for phase 7 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). It
covers what the critique found below the chrome: the Capture details panel opens on hashes
(finding U8), every list row repeats the same Selector chips (U14) with small controls beside
them (A4), the Overview is a second place to edit Selectors and Tags (U12), and an app-wide
switch sits at the top of a Case's Signals (U11). Code references are to `origin/main` at
`03668a1`.

Slices 7.1, 7.2 and 7.4 can start at once. Slice 7.3 waits for frame I and question 7 of
`docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md`.

The rules every slice follows are in the parent plan under "Slices" and in `CLAUDE.md` under
"Posting surfaces".

## Slice 7.1: Capture details open on a summary

Finding U8.

- **Today.** `CaptureDetailsPanel.tsx` renders, in order: the header with the Integrity Status
  chip (`capture-details-provenance-chip`), source and captured rows, then Chain of custody,
  then Tags, then Notes. `custodyOpen` starts `true`, so `ForensicsTab.tsx` (Hash chain,
  Identity, Capture environment, Operator, Headers) fills the panel and pushes Tags and Notes
  below the fold. The panel states the Integrity Status three times: the chip, the Re-verify
  link, and the "Chain status" row.
- **Change.**
  - Chain of custody starts closed. The header chip is then the one statement of Integrity
    Status at rest; Re-verify stays on the section's header, since it is an action.
  - The open or closed state is remembered per installation. `detailsPanelCollapsed` is stored
    in settings today; the new flag goes beside it, in `src/shared/schemas.ts` and
    `src/shared/types.ts`.
  - Nothing inside `ForensicsTab.tsx` changes.
- **Files.** `src/renderer/components/captures/CaptureDetailsPanel.tsx`,
  `src/shared/schemas.ts`, `src/shared/types.ts`.
- **Tests.** `tests/components/CaptureDetailsPanel.test.tsx`: the section starts closed, opens,
  and the choice is written to settings. End to end: `forensics-tab.spec.ts` and
  `readme-screenshots.spec.ts` read inside the section and open it first.
- **Screenshots.** The details panel for one Capture at 1440 by 900, closed and open, before
  and after.
- **Evidence tier.** `CaptureDetailsPanel.tsx` is renderer chrome. `src/shared/types.ts` is
  advisory tier, which is not a label; the pull request notes the new settings key is a display
  preference.
- **Acceptance.**
  - [ ] On a 900 pixel window, Tags and the Note are visible without scrolling when a Capture
    opens.
  - [ ] The Integrity Status reads once at rest.
  - [ ] Re-verify works without opening the section.
  - [ ] The section's state survives a restart.

## Slice 7.2: a count of Selector matches on each list row

Findings U14 and A4.

- **Today.** `CaptureItem.tsx` draws up to two Selector chips and a "+N" chip on
  `capture-item-chip-line`, with a strut that keeps rows the same height. The checkbox is 14
  pixels and the star 16.
- **Change.**
  - The chips become one chip reading the count, for example "3 Selectors". Its title and its
    accessible description list the names. The exclusion chip stays as it is.
  - While the list is filtered by a Selector, the row shows that Selector's name in place of
    the count, so the filter's effect is visible.
  - The star and the checkbox keep their glyph sizes and get 24 pixel hit areas that do not
    overlap.
- **Files.** `src/renderer/components/captures/CaptureItem.tsx`.
- **Tests.** `tests/components/CaptureItem.test.tsx`: the count, the names in the description,
  the filtered case, and that a row with no matches is as tall as one with some.
- **Screenshots.** The Captures list with matches and without, before and after.
- **Evidence tier.** Not in the path list by name. Confirm before starting.
- **Acceptance.**
  - [ ] A row shows at most one Selector chip.
  - [ ] Every matching Selector's name is reachable by pointer and by screen reader.
  - [ ] The star's and the checkbox's hit areas are at least 24 by 24 pixels.
- **Open.** The review pass on a large Case, in
  `docs/plans/2026-11-15-unreviewed-surfaces-review-passes.md`, may show the chips earn their
  place when rows differ. If it lands first, read its findings before starting.

## Slice 7.3: the Overview points to the sections that own the data

Finding U12. Waits for the bundle.

- **Today.** `OverviewSelectorsBlock.tsx` adds Selectors and toggles them, and
  `OverviewTagsBlock.tsx` creates Tags. Signals does both as well. #1547 moves these cards
  toward the standalone mock.
- **Change.** As frame I rules. The parent plan's intent: each card shows a count and what
  changed recently, and links to Signals. Quick Notes keeps its input.
- **Files.** `OverviewSelectorsBlock.tsx`, `OverviewTagsBlock.tsx`, `CaseOverview.tsx`.
- **Tests.** `tests/components/OverviewBlocks.test.tsx`, `CaseOverview.test.tsx`.
- **Screenshots.** The Overview at 1440 by 900, before and after.
- **Evidence tier.** Not evidence-affecting.
- **Acceptance.**
  - [ ] Selectors and Tags are created and edited in one section.
  - [ ] Each Overview card links to that section.
  - [ ] #1547's rows are closed or rewritten, per slice 4.4 of the parent plan.

## Slice 7.4: move the Auto-capture switch to Settings

Finding U11.

- **Today.** `AutoCaptureCard.tsx` sits at the top of a Case's Signals and holds two things: a
  switch that writes the app-wide `autoCaptureMode`, and the Case's own exclusion list. While
  passive capture is suspended it shows `auto-capture-suspended`. The card also carries
  `data-tour="selectors"`, which the tour's `selectors` step rings.
- **Change.**
  - The switch moves to `CapturePreferences.tsx`, with the same three-state handling: the
    switch reads on and refuses to move while the mode is `auto`.
  - Signals keeps the Case's exclusion list as one collapsed row under the Selectors, with a
    link to the setting.
  - `data-tour="selectors"` moves to the Selectors card in `SignalsOverview.tsx`.
- **Files.** `src/renderer/components/signals/AutoCaptureCard.tsx`,
  `src/renderer/components/signals/SignalsOverview.tsx`,
  `src/renderer/components/settings/CapturePreferences.tsx`.
- **Tests.** `tests/components/AutoCaptureCard.test.tsx`, `CapturePreferences.test.tsx`,
  `SignalsOverview.test.tsx`, `OnboardingTour.test.tsx`,
  `tests/renderer/tourSteps.test.ts`. End to end: `onboarding-tour.spec.ts`.
- **Screenshots.** Signals and Settings on the Capture tab, before and after, and the tour's
  Selectors step.
- **Docs.** `features.mdx`, where it says where passive capture is switched.
- **Evidence tier.** `src/renderer/components/signals/**` is excluded from the path list. The
  switch changes when Birdbrain captures, so confirm `CapturePreferences.tsx`'s tier before
  starting.
- **Priority.** Low while passive capture is suspended (ADR-0013, ADR-0037): the switch does
  nothing an Operator can see today.
- **Acceptance.**
  - [ ] The app-wide switch is in Settings and nowhere in a Case.
  - [ ] A Case's exclusions are still edited in that Case.
  - [ ] The tour's Selectors step rings the Selectors card.
