# Consolidation phase 0: the design bundle

**Status:** active

This is the detail plan for slice 0.1 of
`docs/plans/2026-11-15-chrome-capture-export-consolidation.md` (the parent plan, #2201). It
lists what the design bundle has to draw and decide, so that slices 2.3, 4.2 to 4.4, 5.2 to 5.6
and 7.3 can start from a ruled design. Code references are to `origin/main` at `03668a1`.

The bundle is design work, not code. It follows the round trip the earlier bundles used: a page
in the design project, an extracted bundle under `docs/design-handoff/`, a feasibility
assessment under `docs/specs/`, then the maintainer's ruling.

## What the parent plan already fixes

The bundle draws inside these rulings and does not reopen them.

- Share, Export, Import Case Archive and Case settings live in a menu on the Case name
  (decision 1).
- An advisory status colours its dot and adds no icon or word (decision 2).
- A launch carries its VPN warning inside the launch dialog (decision 3).
- The primary control is a filled button labelled "Launch browser" (decision 4).
- The bundle names the rows of the standalone mock it supersedes (decision 5).
- Loose files stay out of the export dialog (decision 6).
- Labels use `CONTEXT.md`'s terms: Evidence Package, Working Copy, Case Archive, Capture
  Session.

## Frames to draw

Each frame is drawn at 1440 and 1100 pixels wide, and the top bar also below 1,000, where
`TopBar.tsx` hides the Case name today.

- [ ] **A. Top bar at rest on a Case.** Logo, Case name as a menu trigger with the Member Code
  chip on a Shared Case, search, status control, Launch browser. The Case menu closed and open.
  The Launch browser menu closed and open, with its Extension and Egress rows. A Shared Case
  in each sync state, a sync error among them.
- [ ] **B. Top bar with no Case open.** The dashboard, the New Case wizard and Settings. Settings
  keeps "Return to Birdbrain".
- [ ] **C. Top bar while a Capture Session runs.** The recording mark as the running state of the
  Launch browser control, for four cases: a launched browser open; a launched browser closed
  with its session still running (`panelView`'s `closed` kind); an extension-only session; a
  notice (`panelView`'s `notice` kind).
- [ ] **D. The labelled rail.** Home, Overview, Captures, Notes, Signals, Data, and Settings at
  the foot with the update dot. Active, hover, focus and disabled states.
- [ ] **E. The right panel on Captures with two tabs.** "Details" and "Capture Session". The
  docked panel, the folded strip, the overlay the strip opens, and the popped-out state, which
  `CaptureSessionDock.tsx` has today as separate forms.
- [ ] **F. The right panel on the other sections.** The Capture Session alone, as today.
- [ ] **G. The export dialog.** The scope line for a whole Case and for a selection; the three
  choices with their file types; the "leave out Operator notes" checkbox; "Customise contents"
  closed and open; the Case Archive choice with the fields that do not apply hidden; the footer
  fixed in view at 900 pixels of height.
- [ ] **H. Status tiers.** Nominal, advisory, problem, and a problem with an advisory behind it,
  each with its popover.
- [ ] **I. Overview cards.** Selectors and Tags as counts with recent changes and a link to
  Signals.
- [ ] **R. Rules.** One sheet stating which control owns which fact, and the superseded rows.

## Questions the bundle has to answer

Each one is open today and blocks the slice named.

1. **What does Launch browser do with no Case open?** `openStartDialog` takes a Case id, and the
   dashboard has no Active Case until one is chosen. Options: disabled with a reason, or a Case
   picker first. Blocks 5.4.
2. **Where does an extension-only Capture Session start and stop?** The switch in
   `SessionControls.tsx` is the only control that starts one today, and 5.5 removes it. Blocks
   5.4 and 5.5.
3. **How wide is the labelled rail?** `Sidebar.tsx` is 48 pixels, and `SIDE_RAIL_PX` in
   `src/renderer/components/captures/captureColumns.ts` feeds the fold rules for the details
   panel and the Capture Session rail. A wider rail moves those thresholds. Blocks 5.2.
4. **Which tab shows when a Capture Session starts, and when a Capture is selected during
   one?** Blocks 2.3.
5. **Does the two-tab panel keep the 480 pixel viewer minimum?** `DOCKED_VIEWER_MIN_PX` came from
   the 2026-11-04 design review, for a layout with two right columns. With one panel the rule
   may no longer be needed. Blocks 2.3.
6. **How do the tour and the Share coach mark point at items inside a closed menu?** The `export`
   step in `tourSteps.ts` and the anchor in `ShareCoachMark.tsx` ring controls that 5.3 moves
   into the Case menu. Options: ring the Case name, or open the menu first. Blocks 5.3.
7. **Which rows of #1555 and #1547 survive?** For each row, the bundle says kept, changed or
   superseded. Blocks 4.4 and 7.3.
8. **Where does a Shared Case's sync state show once the Share pill leaves the chrome?**
   `SharePill.tsx` reads "Share" until a peer joins, then shows the sync state, with an error
   treatment and a notice glyph. Decision 1 moves Share into the Case menu, but a sync error is
   something the Operator must see without opening a menu. Options: on the Case name beside the
   Member Code chip, or as a fourth signal in the status control. Blocks 5.3.

## Deliverables

- [ ] A page in the design project with frames A to I and the rules sheet.
- [ ] A bundle folder under `docs/design-handoff/`, dated the day it is extracted, with the
  canvas, a `README.md`, a `HANDOFF.md` with layout values and tokens, and an
  `ENGINEERING_REVIEW.md` left blank. Render support files load from the 2026-11-01 bundle, as
  the 2026-11-08 bundle's do.
- [ ] A row in the index table of `docs/design-handoff/README.md` that names the bundles and
  mock rows it supersedes, the 2026-11-08 top bar among them.
- [ ] A feasibility assessment under `docs/specs/` with a verdict per frame.
- [ ] The maintainer's ruling, recorded in the parent plan under "Decisions taken".

## Acceptance

- [ ] Every frame uses invented names only, as `docs/README.md` requires.
- [ ] Every question above has one answer on the rules sheet.
- [ ] No frame paints a status background, and the recording mark has no pill, fill or pulse.
  Both carry over from the 2026-11-08 rulings.
- [ ] Control heights and radii follow the tokens in `src/renderer/styles/globals.css`.
- [ ] The feasibility assessment names, for each frame, the slices of the parent plan it
  unblocks.
