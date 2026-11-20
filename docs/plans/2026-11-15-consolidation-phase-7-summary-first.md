# Consolidation phase 7: summary first, and pointers instead of copies

**Status:** active

This is the detail plan for phase 7 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). It
covers what the critique found below the chrome: the Capture details panel opens on hashes
(finding U8), every list row repeats the same Selector chips (U14) with small controls beside
them (A4), the Overview is a second place to edit Selectors and Tags (U12), and an app-wide
switch sits at the top of a Case's Signals (U11). Code references are to `origin/main` at
`ae4b50a`.

Reconciled on 2026-11-16 against the merged parent plan and the review notes left on #2201.

Slices 7.1 and 7.4 can start at once. Slice 7.2 follows review pass 3 of
`docs/plans/2026-11-15-unreviewed-surfaces-review-passes.md`. Slice 7.3 waited for frame I and
question 7 of `docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md`; decision 7 of the
parent plan ruled on both on 2026-11-17, so it can start too.

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
- **Narrower than the parent plan, on purpose.** The parent plan also collapses Identity and
  Capture environment as sections of their own. Those headings are inside `ForensicsTab.tsx`,
  which is `blocking`, so collapsing them there makes the slice `evidence-affecting`. This plan
  collapses only the outer section, which holds all three, and edits no `blocking` file. If
  the maintainer wants the inner sections to fold separately, that is a second,
  `evidence-affecting` pull request.
- **Files.** `src/renderer/components/captures/CaptureDetailsPanel.tsx`,
  `src/shared/schemas.ts`, `src/shared/types.ts`.
- **Tests.** No spec or unit test reads `custody-section-body` or checks a remembered state
  today, so `tests/components/CaptureDetailsPanel.test.tsx` gains both: the section starts
  closed, opens, and the choice is written to settings and read back. End to end:
  `forensics-tab.spec.ts` reads the Hash chain, Identity and Capture environment headings and
  `forensics-chain-status-label`, and `readme-screenshots.spec.ts` reads
  `forensics-chain-status-label`. All of those are inside the section, so both specs open it
  first.
- **Screenshots.** The details panel for one Capture at 1440 by 900, closed and open, before
  and after.
- **Evidence tier.** `CaptureDetailsPanel.tsx` is renderer chrome and `ForensicsTab.tsx` is not
  edited. `src/shared/types.ts` is advisory tier, which is not a label; the pull request notes
  the new settings key is a display preference.
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
- **Settled on 2026-11-19.** The review pass on a large Case, in
  `docs/plans/2026-11-15-unreviewed-surfaces-review-passes.md`, was to say whether this slice
  goes ahead as written. Its assessment,
  `docs/specs/2026-11-19-large-case-review-assessment.md`, says the chips tell rows apart when
  rows differ, and advises one Selector's name and "+N" for the others in place of a bare
  count. Decision 9 of the parent plan rules that form, and #2240 builds it. The first
  "Change" line above and the first acceptance line describe the count as first proposed.

## Slice 7.3: the Overview points to the sections that own the data

Finding U12. No longer waits: decision 7 of the parent plan ruled on the bundle.

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
  switch that writes the app-wide `autoCaptureMode`, and the Case's own exclusion list. Passive
  capture is withdrawn (ADR-0013) and not rebuilt (ADR-0037 says nothing in it is implemented).
  The card's own line, `auto-capture-suspended`, calls it "suspended in this extension build",
  a third word for the same state. The card's root also carries `data-tour="selectors"`, which
  the tour's `selectors` step rings. That step's text ends "auto-capture can log pages that
  hit".
- **Change.**
  - The switch moves to `CapturePreferences.tsx`, with the same three-state handling: the
    switch reads on and refuses to move while the mode is `auto`.
  - Signals keeps the Case's exclusion list as one collapsed row under the Selectors, with a
    link to the setting.
  - `data-tour="selectors"` moves to the Selectors card in `SignalsOverview.tsx`. The parent
    plan does not name this anchor; without the move the step would ring a collapsed row.
  - The `selectors` step in `tourSteps.ts` loses its clause about auto-capture, which describes
    a feature that is withdrawn and a switch that has moved.
- **Files.** `src/renderer/components/signals/AutoCaptureCard.tsx`,
  `src/renderer/components/signals/SignalsOverview.tsx`,
  `src/renderer/components/settings/CapturePreferences.tsx`,
  `src/renderer/components/onboarding/tourSteps.ts`.
- **Tests.** `tests/components/AutoCaptureCard.test.tsx`, `CapturePreferences.test.tsx`,
  `SignalsOverview.test.tsx`, `OnboardingTour.test.tsx`,
  `tests/renderer/tourSteps.test.ts`. End to end: `onboarding-tour.spec.ts`.
- **Screenshots.** Signals and Settings on the Capture tab, before and after, and the tour's
  Selectors step.
- **Docs.** `features.mdx`, where it says where passive capture is switched.
- **Evidence tier.** Not evidence-affecting. The assessment excludes
  `src/renderer/components/signals/**` and `CapturePreferences.tsx` by name, because main
  enforces the values they write.
- **Priority.** Low while passive capture is withdrawn (ADR-0013) and not rebuilt (ADR-0037):
  the switch does nothing an Operator can see today.
- **Acceptance.**
  - [ ] The app-wide switch is in Settings and nowhere in a Case.
  - [ ] A Case's exclusions are still edited in that Case.
  - [ ] The tour's Selectors step rings the Selectors card and does not mention auto-capture.
